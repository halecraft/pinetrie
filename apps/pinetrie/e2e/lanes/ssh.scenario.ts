// e2e/lanes/ssh — a lane's ssh through its host, in a real container: the
// service identity and the owner's, the owner's approval, a forged token,
// the broker, and a revoke.

import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { ROOT, shellWord, type ThreadId } from "@pinetrie/core"
import { runtimeNode } from "@pinetrie/lanes"
import { readAccess } from "@pinetrie/reads"
import { HOP_IN_LANE } from "../../host/work/ssh.ts"
import type { Checks } from "../checks.ts"
import { join, START_AGENT, SUITE_CONFIG, waitFor } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import { cli, container, runtimeCli } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => sshSection(check, lanes),
}

const OWNER = "owner@ssh.test"
const BANNER = "SSH-2.0-pinetrie-e2e\r\n"
const HOP = [...runtimeNode(HOP_IN_LANE)].map(shellWord).join(" ")
/** `script` in a running lane's container, awaited without blocking the host. */
function inLaneLater(lane: ThreadId, script: string): Promise<string> {
  const [program = "docker", ...rest] = runtimeCli()
  return new Promise(resolve => {
    const child = spawn(program, [
      ...rest,
      "exec",
      container(lane),
      "sh",
      "-c",
      script,
    ])
    let out = ""
    child.stdout.on("data", d => {
      out += d.toString()
    })
    child.stderr.on("data", d => {
      out += d.toString()
    })
    child.on("close", () => resolve(out))
  })
}

/** A throwaway key pair, as `ssh-keygen` makes one. */
function keyPair(file: string, comment: string): string {
  spawnSync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    comment,
    "-f",
    file,
  ])
  chmodSync(file, 0o600)
  return readFileSync(`${file}.pub`, "utf8").trim()
}

async function sshSection(check: Checks["check"], lanes: LaneHosts) {
  // The user config's folder: the owner, and a service key with a config
  // naming the host's banner server.
  const conf = mkdtempSync(path.join(tmpdir(), "pinetrie-ssh-conf-"))
  const serviceDir = path.join(conf, "ssh")
  mkdirSync(serviceDir)
  const servicePub = keyPair(path.join(serviceDir, "deploy"), "deploy")
  const connections: net.Socket[] = []
  const banner = net.createServer({ allowHalfOpen: true }, c => {
    connections.push(c)
    c.write(BANNER)
    c.pipe(c)
  })
  await new Promise<void>(r => banner.listen(0, "127.0.0.1", r))
  const address = banner.address()
  const port =
    typeof address === "object" && address !== null ? address.port : 0
  writeFileSync(
    path.join(serviceDir, "config"),
    `Host banner\n  HostName 127.0.0.1\n  Port ${port}\n`,
  )
  const configFile = path.join(conf, "config.json")
  writeFileSync(
    configFile,
    JSON.stringify({
      ...SUITE_CONFIG,
      owner: OWNER,
      lanes: { ssh: { personal: true } },
    }),
  )
  // The person's own: an empty ~/.ssh, and an agent of the scenario's with one key.
  const home = mkdtempSync(path.join(tmpdir(), "pinetrie-ssh-home-"))
  mkdirSync(path.join(home, ".ssh"))
  const personalPub = keyPair(path.join(home, "me"), "me")
  const agentSocket = path.join(home, "agent.sock")
  const agent = spawn("ssh-agent", ["-D", "-a", agentSocket], {
    stdio: "ignore",
  })
  await waitFor(
    () => spawnSync("test", ["-S", agentSocket]).status === 0,
    10_000,
  )
  spawnSync("ssh-add", ["-q", path.join(home, "me")], {
    env: { ...process.env, SSH_AUTH_SOCK: agentSocket },
  })

  const h = await lanes.sectionHost({
    files: { "a.txt": "a\n" },
    userConfig: configFile,
    ssh: { dir: path.join(home, ".ssh"), agent: agentSocket },
  })
  const owner = await join(h.host, "owner", "ssh")
  try {
    h.script.use([{ text: "made" }])
    await h.user.chat("@agent make a lane", ROOT, START_AGENT)
    await h.idle()
    const lane = h.laneWith("made")?.name
    if (lane === undefined) throw new Error("no lane was made")
    cli(["start", container(lane)])
    // The hop starts with the container: ready once `ssh-add` reaches an
    // agent (exit 2 is "cannot connect"). A socket file proves nothing, since
    // one an earlier start left outlives the stop.
    await waitFor(
      async () =>
        (
          await inLaneLater(lane, "ssh-add -l >/dev/null 2>&1; echo $?")
        ).trim() !== "2",
      30_000,
    ).catch(() => 0)

    const listed = await inLaneLater(lane, `ssh-add -L`)
    const [first, second] = listed.trim().split("\n")
    check(
      "a lane lists the service key before the personal one",
      first?.split(" ")[1] === servicePub.split(" ")[1] &&
        second?.split(" ")[1] === personalPub.split(" ")[1],
      listed.slice(0, 200),
    )

    const sign = (line: number) =>
      `ssh-add -L | sed -n ${line}p > /tmp/k.pub && echo x > /tmp/m && ssh-keygen -Y sign -n file -f /tmp/k.pub /tmp/m >/dev/null 2>&1 && echo SIGNED`
    const service = await inLaneLater(lane, sign(1))
    check(
      "a service signature needs no approval",
      service.includes("SIGNED") &&
        readAccess(h.host.session).get(lane)?.personal === null,
      service.slice(0, 200),
    )

    const personal = inLaneLater(lane, sign(2))
    // A lane that never waits fails the check below, not the scenario.
    await waitFor(
      () => readAccess(h.host.session).get(lane)?.personal?.kind === "waiting",
      30_000,
    ).catch(() => 0)
    let signedEarly = false
    void personal.then(() => {
      signedEarly = true
    })
    // The record waits only while the relay holds the signature, so the
    // exec cannot have ended by now unless it was signed unasked.
    const waited =
      !signedEarly &&
      readAccess(h.host.session).get(lane)?.personal?.kind === "waiting"
    await owner.access(lane, "approve")
    const signed = await personal
    check(
      "a personal signature waits for its owner's approval",
      waited && signed.includes("SIGNED"),
      signed.slice(0, 200),
    )

    const forged = await inLaneLater(
      lane,
      `python3 -c 'import os,socket;s=socket.socket(socket.AF_UNIX);s.connect(os.environ["PINETRIE_SSH_SOCKET"]);s.sendall(b"agent dGVzdA.00\\n\\0\\0\\0\\1\\x0b");print("got", len(s.recv(100)))'`,
    )
    check(
      "a connection with another lane's token gets nothing",
      forged.includes("got 0"),
      forged.slice(0, 200),
    )

    const brokered = await inLaneLater(
      lane,
      `${HOP} connect banner ${port} < /dev/null`,
    )
    check(
      "the broker connects a host's alias from the host",
      brokered.includes(BANNER.trim()),
      brokered.slice(0, 200),
    )

    const before = connections.length
    // The hop's input stays open on a FIFO a detached `tail` holds, so the
    // shell ends when the hop does.
    const held = inLaneLater(
      lane,
      `rm -f /tmp/in; mkfifo /tmp/in; (tail -f /dev/null > /tmp/in 2>/dev/null &); start=$(date +%s); ${HOP} connect banner ${port} < /tmp/in > /dev/null; echo ENDED $(( $(date +%s) - start ))`,
    )
    await waitFor(() => connections.length > before, 30_000).catch(() => 0)
    const revoked = await owner.access(lane, "revoke")
    const ended = await held
    const seconds = Number(/ENDED (\d+)/.exec(ended)?.[1] ?? "99")
    check(
      "a revoke ends the lane's open connection",
      seconds < 30,
      `${ended.slice(0, 120)} · ${JSON.stringify(revoked).slice(0, 120)} · ${readAccess(h.host.session).get(lane)?.personal?.kind}`,
    )
  } finally {
    await owner.close().catch(() => {})
    await h.close()
    agent.kill()
    banner.close()
    rmSync(conf, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}
