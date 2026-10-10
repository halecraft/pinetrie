#!/usr/bin/env node
// What a call to a helper costs: a fresh `docker exec` (CLI and API) against a
// message over one held `docker exec -i` (thread smart-dolphin).
//
// Run on the Mac, with a pine·trie host running (the lane VM up):
//   node .plans/helper-probes/rtt.mjs
// Writes rtt.txt beside itself. About a minute. Uses the running
// `pinetrie-disks` helper, and makes and deletes subvolumes under
// projects/<key>/probe-rtt/ only.
//
// Overrides, for a run elsewhere: DOCKER_SOCK, HELPER, PROBE_DIR.

import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

const STATE =
  process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state")
const SOCK =
  process.env.DOCKER_SOCK ?? path.join(STATE, "pinetrie", "vm", "docker.sock")
const HELPER = process.env.HELPER ?? "pinetrie-disks"
const DIR =
  process.env.PROBE_DIR ??
  "/var/lib/lanehost/projects/dff06c0e66d017b0/probe-rtt"
const H = ["-H", `unix://${SOCK}`]

const lines = []
const say = s => {
  lines.push(s)
  console.log(s)
}
const now = () => Number(process.hrtime.bigint()) / 1e6

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return `mean ${mean.toFixed(2)}  p50 ${q(0.5).toFixed(2)}  p90 ${q(0.9).toFixed(2)}  min ${s[0].toFixed(2)} ms  (n=${s.length})`
}

async function timed(n, f) {
  await f() // warm
  const xs = []
  for (let i = 0; i < n; i++) {
    const t0 = now()
    await f()
    xs.push(now() - t0)
  }
  return stats(xs)
}

/** The docker CLI, as the host runs it (`execFile`), to its exit. */
const cli = args =>
  new Promise((resolve, reject) => {
    const p = spawn("docker", [...H, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let err = ""
    p.stderr.on("data", d => (err += d))
    p.stdout.resume()
    p.on("error", reject)
    p.on("close", code =>
      code === 0
        ? resolve()
        : reject(new Error(`docker ${args.join(" ")}: ${code} ${err}`)),
    )
  })

/** One request to the Docker API on its socket; resolves when the body ends. */
const api = (method, url, body) =>
  new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: SOCK,
        method,
        path: url,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data),
            }
          : {},
      },
      res => {
        let out = ""
        res.on("data", d => (out += d))
        res.on("end", () =>
          res.statusCode < 300
            ? resolve(out)
            : reject(new Error(`${url}: ${res.statusCode} ${out}`)),
        )
      },
    )
    req.on("error", reject)
    if (data) req.write(data)
    req.end()
  })

/** `exec` through the API: create, then start attached, to the process's end. */
async function apiExec(cmd) {
  const { Id } = JSON.parse(
    await api("POST", `/containers/${HELPER}/exec`, {
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    }),
  )
  await new Promise((resolve, reject) => {
    const data = JSON.stringify({ Detach: false, Tty: false })
    const req = http.request({
      socketPath: SOCK,
      method: "POST",
      path: `/exec/${Id}/start`,
      agent: false,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
    })
    const drain = s => {
      s.on("data", () => {})
      s.on("end", resolve)
      s.on("close", resolve)
      s.on("error", reject)
    }
    req.on("upgrade", (_res, socket) => drain(socket))
    req.on("response", res => drain(res))
    req.on("error", reject)
    req.write(data)
    req.end()
  })
  const { ExitCode } = JSON.parse(await api("GET", `/exec/${Id}/json`))
  if (ExitCode !== 0) throw new Error(`${cmd.join(" ")}: exit ${ExitCode}`)
}

/**
 * A held `docker exec -i` running a line server: each line in is a request,
 * each line out its answer. `mode` "echo" answers at once; "sh" runs the line
 * in a forked shell and answers with its exit status.
 */
function channel(mode) {
  const script =
    mode === "echo"
      ? 'while IFS= read -r l; do printf "%s\\n" "$l"; done'
      : 'while IFS= read -r l; do sh -c "$l" >/dev/null 2>&1; echo "$?"; done'
  const p = spawn("docker", [...H, "exec", "-i", HELPER, "sh", "-c", script], {
    stdio: ["pipe", "pipe", "inherit"],
  })
  let buf = ""
  const waiting = []
  p.stdout.on("data", d => {
    buf += d
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      waiting.shift()?.(line)
    }
  })
  return {
    ask: line =>
      new Promise((resolve, reject) => {
        waiting.push(answer =>
          mode === "sh" && answer !== "0"
            ? reject(new Error(`${line}: exit ${answer}`))
            : resolve(answer),
        )
        p.stdin.write(`${line}\n`)
      }),
    close: () =>
      new Promise(resolve => {
        p.on("close", resolve)
        p.stdin.end()
      }),
  }
}

const SNAP = `btrfs -q subvolume snapshot ${DIR}/src ${DIR}/dst && btrfs -q subvolume delete ${DIR}/dst`

say(`socket ${SOCK}, helper ${HELPER}, ${new Date().toISOString()}`)
say(`host ${os.type()} ${os.release()} ${os.arch()}, node ${process.version}`)
await cli([
  "exec",
  HELPER,
  "sh",
  "-c",
  `rm -rf ${DIR}; mkdir -p ${DIR} && btrfs -q subvolume create ${DIR}/src && echo x > ${DIR}/src/f`,
])
try {
  say("")
  say("== the bridge alone")
  say(
    `API GET /_ping                          ${await timed(200, () => api("GET", "/_ping"))}`,
  )
  say(
    `API GET /containers/<helper>/json      ${await timed(100, () => api("GET", `/containers/${HELPER}/json`))}`,
  )
  say(
    `CLI docker version                     ${await timed(20, () => cli(["version", "--format", "{{.Server.Version}}"]))}`,
  )
  say(
    `CLI docker inspect <helper>            ${await timed(20, () => cli(["inspect", "-f", "{{.State.Running}}", HELPER]))}`,
  )

  say("")
  say("== a call that does nothing (`true`)")
  say(
    `CLI docker exec (what the host does)   ${await timed(30, () => cli(["exec", HELPER, "true"]))}`,
  )
  say(
    `API exec create + start + inspect      ${await timed(30, () => apiExec(["true"]))}`,
  )
  const echo = channel("echo")
  say(
    `held exec -i, echo a line              ${await timed(500, () => echo.ask("ping"))}`,
  )
  await echo.close()
  const sh = channel("sh")
  say(
    `held exec -i, fork \`true\` in it       ${await timed(200, () => sh.ask("true"))}`,
  )

  say("")
  say("== a real disk operation: snapshot a subvolume, then delete it")
  say(
    `CLI docker exec                        ${await timed(30, () => cli(["exec", HELPER, "sh", "-c", SNAP]))}`,
  )
  say(
    `API exec                               ${await timed(30, () => apiExec(["sh", "-c", SNAP]))}`,
  )
  say(
    `held exec -i, forked in it             ${await timed(100, () => sh.ask(SNAP))}`,
  )
  await sh.close()
} finally {
  await cli([
    "exec",
    HELPER,
    "sh",
    "-c",
    `btrfs -q subvolume delete ${DIR}/dst 2>/dev/null; btrfs -q subvolume delete ${DIR}/src; rmdir ${DIR}`,
  ]).catch(e => say(`cleanup failed: ${e.message}`))
}
writeFileSync(
  path.join(import.meta.dirname, "rtt.txt"),
  `${lines.join("\n")}\n`,
)
