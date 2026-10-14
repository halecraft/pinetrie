// e2e/lanes/contract — what the Docker runtime must hold that no unit test can
// show: snapshots under writes, the working copy read-only on the Mac's side, a
// half-close through the launcher, no vsock from a lane, two hosts' slots
// apart, and what a lane's start and a snapshot cost. On the Mac it runs a VM
// of its own, from this checkout's launcher and the built image, so a change to
// the launcher is what runs, and the person's hosts are untouched.

import { execFile, spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type SnapshotId,
  snapshotId,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import { LANEHOST_LABEL, projectKey } from "@pinetrie/docker"
import {
  ensureRuntime,
  executeOrThrow,
  type LaneRuntime,
  laneContainer,
  type Mount,
  PINETRIE_INSTALL,
  PINETRIE_MOUNT,
  pinetrieDir,
  planSnapshot,
  prepareImages,
  RUNTIME_MOUNT,
  run,
} from "@pinetrie/lanes"
import { GVPROXY_HOST_ADDRESS } from "@pinetrie/vm"
import { findProject } from "../../host/work/runtime.ts"
import { playwrightVersion } from "../../host/work/setup.ts"
import type { Checks } from "../checks.ts"
import { committedProject, waitFor } from "../harness.ts"
import { ownForInnerLanes } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"
import { cli, dockerDisks, inDisks, ownVm, sh } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check, skip }) => dockerContract(check, skip),
}

// ── Docker ────────────────────────────────────────────────────────────────

/** Snapshots the Docker contract takes while a lane writes. */
const SNAPSHOTS = 20

/** Records appended without fsync, the count published as it goes. */
const WRITER = `const fs = require("fs")
const fd = fs.openSync("/workspace/log.bin", "a")
let n = 0
while (!fs.existsSync("/probe/stop")) {
  fs.writeSync(fd, "rec " + String(n).padStart(8, "0") + " " + "x".repeat(40) + "\\n")
  n++
  if (n % 10 === 0) fs.writeFileSync("/probe/written", String(n))
}
`

const median = (xs: readonly number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

/**
 * A server on the Mac's loopback, answering `mac <name>`, in a process of its
 * own: this one blocks while a lane connects. Its port, and how to stop
 * it.
 */
async function loopbackServer(
  name: string,
): Promise<{ readonly port: number; stop(): void }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require("http").createServer((q, r) => r.end("mac ${name}")).listen(0, "127.0.0.1", function () { console.log(this.address().port) })`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  )
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout?.once("data", d => resolve(Number(String(d).trim())))
    child.once("exit", code => reject(new Error(`the server exited ${code}`)))
  })
  // However the scenario ends, the server does not outlive it.
  process.once("exit", () => child.kill())
  return { port, stop: () => child.kill() }
}

async function dockerContract(
  check: Checks["check"],
  skip: Checks["skip"],
): Promise<void> {
  const own = ownVm({
    share: ["images", "bin", "builder"],
    data: "contract-data.img",
  })
  const onMac = process.platform === "darwin"
  const closedPort = await loopbackServer("closed")
  const grantedPort = await loopbackServer("granted")
  const logs: string[] = []
  const log = (l: string) => {
    logs.push(l)
    if (process.env.PINETRIE_E2E_LOG === "1") console.log(l)
  }
  const slots = 16
  const projA = committedProject("pinetrie-contract-a-", { "README.md": "a\n" })
  const projB = committedProject("pinetrie-contract-b-", { "README.md": "b\n" })
  mkdirSync(path.join(projA, ".plans"))
  const probe = realpathSync(
    mkdtempSync(path.join(tmpdir(), "pinetrie-probe-")),
  )
  writeFileSync(path.join(probe, "writer.js"), WRITER)
  ownForInnerLanes(probe)
  ownForInnerLanes(path.join(projA, ".plans"))
  const a = await findProject({
    root: projA,
    slots,
    // No lane here holds an ssh identity: nothing listens there.
    hostSocket: path.join(projA, ".no-ssh.sock"),
    log,
  })
  if (a?.kind !== "found")
    throw new Error(`no Docker runtime: ${a === null ? "no project" : a.words}`)
  const { runtime } = a
  const cold = /Docker answered (\d+) ms after the launcher started/.exec(
    logs.join("\n"),
  )?.[1]
  const lanes: ThreadId[] = []
  const snapshots: SnapshotId[] = []
  /** A lane of host A's, on a new disk, with the working copy, a shared directory and the probe. */
  /** Host A's directories, as its slot shares them. */
  const mountsOfA = [
    { source: projA, target: "/mnt/host-working-copy", readonly: true },
    {
      source: path.join(projA, ".plans"),
      target: "/workspace/.plans",
      readonly: false,
    },
    { source: probe, target: "/probe", readonly: false },
  ] as const
  /** A lane on `on`'s runtime, mounting only what that host's slot shares. */
  const lane = async (
    image: string,
    on: LaneRuntime = runtime,
    mounts: readonly Mount[] = mountsOfA,
  ): Promise<ThreadId> => {
    const name = threadIdFor(`contract-${process.pid}-${lanes.length}`)
    lanes.push(name)
    laneRuntimes.set(name, on)
    await on.disk({ kind: "create", lane: name })
    const started = Date.now()
    await on.run({
      name: laneContainer(name),
      lane: name,
      image,
      memory: "1g",
      mounts,
      env: {},
      hostSocket: null,
      starts: [],
      nested: false,
      hostPorts: [],
    })
    runMs.push(Date.now() - started)
    return name
  }
  const runMs: number[] = []
  const laneRuntimes = new Map<ThreadId, LaneRuntime>()
  const exec = (name: ThreadId, script: string) => {
    const on = laneRuntimes.get(name) ?? runtime
    const [p = "docker", ...rest] = on.execArgv(laneContainer(name), [
      "sh",
      "-c",
      script,
    ])
    return run(p, rest)
  }
  try {
    // ── a half-close: first, before anything streams through the bridge
    // (the slot's fill sweeps through lanehost's held exec), so a broken
    // bridge fails here and not in a check after it. Only API calls come
    // before it: Docker's version, the slot's sweep, the pull. ──
    const echoed = quietCli(["run", "--rm", "-i", ALPINE_IMAGE, "cat"], "hi\n")
    check(
      "echo hi | docker run -i … cat returns hi: stdin's end reaches the lane, and its output comes back",
      echoed.trim() === "hi",
      JSON.stringify(echoed),
    )

    // Lanehost's server runs from pine·trie's install on the lane runtime,
    // which a host copies out of the default image.
    const { runtimeFrom } = await prepareImages(
      runtime,
      projA,
      playwrightVersion(),
      log,
    )
    const serverMounts: readonly Mount[] = [
      { source: PINETRIE_INSTALL, target: PINETRIE_MOUNT, readonly: true },
      {
        source: await ensureRuntime(
          runtime,
          pinetrieDir(projA).runtime,
          runtimeFrom,
        ),
        target: RUNTIME_MOUNT,
        readonly: true,
      },
    ]
    await a.ready({
      defaultImage: "",
      hostPorts: [grantedPort.port],
      mounts: [...mountsOfA, ...serverMounts],
    })
    for (const image of [NODE_IMAGE, PYTHON_IMAGE, ALPINE_IMAGE])
      await runtime.runInImage(image, ["true"])

    // ── lanehost's privileged role: the host's grant made it ──
    const privileged = quietCli([
      "ps",
      "--filter",
      `label=pinetrie.project=${projectKey(projA)}`,
      "--filter",
      `label=${LANEHOST_LABEL}=privileged`,
      "--format",
      "{{.Names}}",
    ]).trim()
    if (privileged === "")
      skip(
        "lanehost's privileged role cannot write the lanes directory",
        "nothing here needs the privileged role: no grant of the host's ports, and no diff by send under rootless Docker",
      )
    else {
      const wrote = quietCli([
        "exec",
        privileged,
        "touch",
        `${dockerDisks(projA).dir}/from-privileged`,
      ])
      check(
        "lanehost's privileged role cannot write the lanes directory",
        /read-only/i.test(wrote),
        wrote.trim(),
      )
    }

    // ── snapshots under writes ──
    const writerLane = await lane(NODE_IMAGE)
    const [wp = "docker", ...wrest] = runtime.execArgv(
      laneContainer(writerLane),
      ["node", "/probe/writer.js"],
    )
    const writing = new Promise<void>(resolve =>
      execFile(wp, wrest, () => resolve()),
    )
    const written = () =>
      Number(
        existsSync(path.join(probe, "written"))
          ? readFileSync(path.join(probe, "written"), "utf8").trim() || "0"
          : "0",
      )
    await waitFor(() => written() >= 100, 30_000)
    const snapMs: number[] = []
    const timed: typeof runtime = {
      ...runtime,
      disk: async op => {
        const t = Date.now()
        await runtime.disk(op)
        snapMs.push(Date.now() - t)
      },
    }
    const runners = {
      runtime: timed,
      lane: (argv: readonly string[]) => {
        const [p = "docker", ...rest] = runtime.execArgv(
          laneContainer(writerLane),
          argv,
        )
        return run(p, rest)
      },
      laneBytes: async () => {
        throw new Error("no bytes here")
      },
    }
    const promised: [SnapshotId, number][] = []
    for (let i = 0; i < SNAPSHOTS; i++) {
      const id = snapshotId(`contract-${process.pid}-${i}`)
      const count = written()
      snapshots.push(id)
      await executeOrThrow(
        planSnapshot({ lane: writerLane, snapshot: id }),
        runners,
      )
      promised.push([id, count])
      // The next snapshot lands a random number of records later, so each
      // falls somewhere new in the write.
      const later = count + 10 * (1 + Math.floor(Math.random() * 50))
      await waitFor(() => written() >= later, 10_000)
    }
    writeFileSync(path.join(probe, "stop"), "")
    await writing
    const disks = dockerDisks(projA)
    const holding = promised.filter(([id, count]) => {
      const out = inDisks(
        projA,
        'head -n "$2" "$1/log.bin" | awk \'!/^rec [0-9]{8} x{40}$/ { b++ } END { print b + 0 }\'; wc -l < "$1/log.bin"',
        disks.snapshot(id),
        String(count),
      )
      const [bad, have] = out.trim().split(/\s+/).map(Number)
      return bad === 0 && (have ?? 0) >= count
    })
    check(
      "every snapshot taken while a lane writes holds every record written before it",
      holding.length === SNAPSHOTS,
      `${holding.length} of ${SNAPSHOTS}`,
    )

    // ── a diff between two snapshots ──
    await exec(writerLane, "echo gone > /workspace/gone.txt")
    const diffFrom = snapshotId(`contract-${process.pid}-before`)
    const diffTo = snapshotId(`contract-${process.pid}-after`)
    snapshots.push(diffFrom, diffTo)
    await executeOrThrow(
      planSnapshot({ lane: writerLane, snapshot: diffFrom }),
      runners,
    )
    await exec(
      writerLane,
      "rm /workspace/gone.txt && echo kept > /workspace/kept.txt",
    )
    await executeOrThrow(
      planSnapshot({ lane: writerLane, snapshot: diffTo }),
      runners,
    )
    const diffed = await runtime.diff(diffFrom, diffTo)
    const named = Object.fromEntries(
      diffed.changes.map(c => [c.path, c.change]),
    )
    check(
      "a diff between two snapshots of a lane reports a file it deleted, and one it made",
      named["gone.txt"] === "deleted" && named["kept.txt"] === "added",
      JSON.stringify(diffed.changes.slice(0, 5)),
    )

    // ── the working copy ──
    const wc = await exec(
      writerLane,
      "touch /mnt/host-working-copy/from-lane 2>&1; echo done",
    )
    let capped = "not on the Mac"
    if (process.platform === "darwin") {
      // The working copy's source in the VM, as the lane binds it.
      const source = cli([
        "inspect",
        "-f",
        '{{range .Mounts}}{{if eq .Destination "/mnt/host-working-copy"}}{{.Source}}{{end}}{{end}}',
        laneContainer(writerLane),
      ]).trim()
      capped = quietCli([
        "run",
        "--rm",
        "--cap-add",
        "SYS_ADMIN",
        "--mount",
        `type=bind,source=${source},target=/w`,
        ALPINE_IMAGE,
        "sh",
        "-c",
        "mount -o remount,rw /w 2>&1; touch /w/from-capped 2>&1; echo done",
      ])
    }
    check(
      "the working copy cannot be written from a lane, nor on the Mac from a container with CAP_SYS_ADMIN",
      !existsSync(path.join(projA, "from-lane")) &&
        !existsSync(path.join(projA, "from-capped")),
      `${wc.stdout.trim()} | ${capped.trim()}`,
    )

    // ── vsock ──
    const pyLane = await lane(PYTHON_IMAGE)
    const vsock = await exec(
      pyLane,
      `python3 -c 'import socket; socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); print("opened")' 2>&1`,
    )
    // A failure's traceback quotes the source line, which says "opened" too.
    check(
      "a lane cannot open a vsock socket",
      !vsock.stdout.split("\n").some(l => l.trim() === "opened"),
      vsock.stdout.trim().split("\n").at(-1) ?? "",
    )

    // ── the fence: the Mac's loopback and gvproxy's API ──
    /** What a lane got from `url`: the server's answer, or wget's error. */
    const fetchFrom = async (name: ThreadId, url: string) =>
      (
        await exec(name, `wget -q -T 3 -O - '${url}' 2>&1 || echo "failed"`)
      ).stdout.trim()
    if (onMac) {
      const fenced = await lane(ALPINE_IMAGE)
      const loopback = await fetchFrom(
        fenced,
        `http://${GVPROXY_HOST_ADDRESS}:${closedPort.port}/`,
      )
      const api = await fetchFrom(
        fenced,
        "http://192.168.127.1/services/forwarder/all",
      )
      check(
        "a lane cannot reach the Mac's loopback, nor gvproxy's API that opens ports on the Mac",
        !loopback.includes("mac closed") && api.includes("failed"),
        `loopback: ${loopback.split("\n").at(-1)} | API: ${api.split("\n").at(-1)}`,
      )
    } else
      skip(
        "a lane cannot reach the Mac's loopback, nor gvproxy's API that opens ports on the Mac",
        "gvproxy is the Mac's lane VM's network",
      )

    // ── two hosts' slots ──
    const mountsOfB = [
      { source: projB, target: "/mnt/host-working-copy", readonly: true },
    ] as const
    const b = await findProject({
      root: projB,
      slots,
      hostSocket: path.join(projB, ".no-ssh.sock"),
      log,
    })
    if (b?.kind === "found") {
      await b.ready({
        defaultImage: "",
        hostPorts: [],
        mounts: [...mountsOfB, ...serverMounts],
      })
      if (onMac) {
        const granted = `http://${GVPROXY_HOST_ADDRESS}:${grantedPort.port}/`
        const ofA = await fetchFrom(await lane(ALPINE_IMAGE), granted)
        const laneOfB = await lane(ALPINE_IMAGE, b.runtime, mountsOfB)
        const ofB = await fetchFrom(laneOfB, granted)
        check(
          "a port of the Mac's loopback the project grants answers its lanes, and not another project's",
          ofA.includes("mac granted") && !ofB.includes("mac granted"),
          `project A: ${ofA.split("\n").at(-1)} | project B: ${ofB.split("\n").at(-1)}`,
        )
        await b.runtime.remove(laneContainer(laneOfB)).catch(() => {})
        await b.runtime.disk({ kind: "delete", lane: laneOfB }).catch(() => {})
        laneRuntimes.delete(laneOfB)
        lanes.splice(lanes.indexOf(laneOfB), 1)
      } else
        skip(
          "a port of the Mac's loopback the project grants answers its lanes, and not another project's",
          "gvproxy is the Mac's lane VM's network",
        )
      await b.close()
    }
    const after = await exec(
      writerLane,
      "cat /mnt/host-working-copy/README.md && echo from-a > /workspace/.plans/after.md && echo ok",
    )
    check(
      "a second host started and stopped beside the first leaves the first's lane reading its working copy and writing its shared directory",
      after.stdout.includes("a\nok") &&
        existsSync(path.join(projA, ".plans", "after.md")),
      after.stdout.trim().replace(/\n/g, " ") + after.stderr.trim(),
    )

    // ── costs ──
    await lane(ALPINE_IMAGE)
    const runCost = median(runMs.slice(1))
    const snapCost = median(snapMs)
    // A first boot formats the data disk: not the cold start lanes see.
    const formatted =
      own !== null &&
      quietSh(
        `grep -c 'data disk formatted' '${path.join(own.state, "pinetrie", "vm", "console.log")}' || true`,
      ).trim() !== "0"
    const coldMs = cold === undefined || formatted ? null : Number(cold)
    const files =
      own === null
        ? "n/a"
        : quietSh(
            `lsof -p "$(pgrep -f 'launcher-.* ${own.state}' | head -1)" 2>/dev/null | wc -l`,
          ).trim()
    check(
      "a lane's docker run -d takes under 150 ms, a snapshot under 50 ms, and a cold VM answers in under 2 s",
      runCost < 150 && snapCost < 50 && (coldMs === null || coldMs < 2000),
      `run -d ${runCost} ms, snapshot ${snapCost} ms, cold start ${formatted ? `${cold} ms, not held: the data disk's first format` : coldMs === null ? "n/a" : `${coldMs} ms on a formatted data disk`}, the launcher's open files ${files}`,
    )

    // ── the VM stops under a running host: it leases again ──
    if (own !== null) {
      const before = logs.length
      quietSh(`pkill -TERM -f 'launcher-.* ${own.state}' || true`)
      const again = await waitFor(
        () =>
          logs.slice(before).some(l => l.includes("leased the lane VM again")),
        120_000,
      ).catch(() => -1)
      const relaned = again < 0 ? null : await lane(ALPINE_IMAGE)
      const read =
        relaned === null
          ? "no new lease"
          : (
              await exec(relaned, "cat /mnt/host-working-copy/README.md")
            ).stdout.trim()
      check(
        "a host whose lane VM stops leases again, and a new lane runs and reads its working copy",
        read === "a",
        `${read} | ${logs
          .slice(before)
          .filter(l => l.includes("lane VM"))
          .join(" | ")}`,
      )
    } else
      skip(
        "a host whose lane VM stops leases again, and a new lane runs and reads its working copy",
        "the Mac's lane VM only",
      )
  } finally {
    for (const l of lanes) {
      const on = laneRuntimes.get(l) ?? runtime
      await on.remove(laneContainer(l)).catch(() => {})
      await on.disk({ kind: "delete", lane: l }).catch(() => {})
    }
    closedPort.stop()
    grantedPort.stop()
    await runtime
      .disk({ kind: "deleteSnapshots", ids: snapshots })
      .catch(() => {})
    await a.close()
    if (own !== null) {
      // The contract's VM stops once its last lease ends.
      await waitFor(
        () => quietSh(`pgrep -f '${own.state}' || true`).trim() === "",
        60_000,
      ).catch(() => {})
      own.restore()
      rmSync(own.state, { recursive: true, force: true })
    }
    for (const d of [projA, projB, probe])
      rmSync(d, { recursive: true, force: true })
  }
}

const NODE_IMAGE = "docker.io/library/node:24-alpine"
const PYTHON_IMAGE = "docker.io/library/python:3-alpine"
const ALPINE_IMAGE = "docker.io/library/alpine:3.23"

/** The runtime's CLI with a failure as its output. */
function quietCli(args: readonly string[], input?: string): string {
  try {
    return cli(args, input)
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer }
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`
  }
}

function quietSh(command: string): string {
  try {
    return sh(command)
  } catch {
    return ""
  }
}
