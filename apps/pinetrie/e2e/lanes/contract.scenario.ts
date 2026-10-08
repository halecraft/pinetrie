// e2e/lanes/contract — what each runtime must hold that no unit test can
// show (ADR-0103).
// - `container` does not promise that a clone written into a volume it made
//   works, so every upgrade reruns a small soak.
// - Docker: snapshots under writes, the working copy read-only on the Mac's
//   side, a half-close through the launcher, no vsock from a lane, two hosts'
//   slots apart, and what a lane's start and a snapshot cost. On the Mac it
//   runs a VM of its own, from this checkout's launcher and the built image,
//   so a change to the launcher is what runs, and the person's hosts are
//   untouched.

import { execFile, execFileSync, spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { createVolume } from "@pinetrie/container"
import {
  type LaneName,
  laneNameForThread,
  type SnapshotId,
  snapshotId,
} from "@pinetrie/core"
import {
  describeFailure,
  executeOrThrow,
  type LaneRuntime,
  laneContainer,
  type Mount,
  planSnapshot,
  run,
} from "@pinetrie/lanes"
import { GVPROXY_HOST_ADDRESS, vmStateDir } from "@pinetrie/vm"
import { findProject } from "../../host/work/runtime.ts"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  E2E_RUNTIME,
  runtimeProblem,
  waitFor,
} from "../harness.ts"
import { ownForInnerLanes } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"
import {
  cli,
  dockerDisks,
  ensureFsckImage,
  FSCK_IMAGE,
  inDisks,
  sh,
} from "./support.ts"

export const scenario: Scenario = {
  needs: runtimeProblem,
  run: ({ check, skip }) =>
    E2E_RUNTIME === "docker"
      ? dockerContract(check, skip)
      : contractSection(check),
}

/** Clones the contract checks. */
const CLONES = 20

async function contractSection(check: Checks["check"]): Promise<void> {
  const status = JSON.parse(sh("container system status --format json")) as {
    paths: { appRoot: string }
  }
  const volume = `pinetrie-contract-${process.pid}`
  const image = path.join(status.paths.appRoot, "volumes", volume, "volume.img")
  const probe = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-soak-")))
  const clones = path.join(probe, "clones")
  sh(`mkdir -p ${clones}`)
  // Appends fsynced records, and churns files, until the host says stop.
  writeFileSync(
    path.join(probe, "writer.js"),
    `const fs = require("fs"), crypto = require("crypto")
const fd = fs.openSync("/workspace/log.bin", "a")
let n = 0
while (!fs.existsSync("/probe/stop")) {
  fs.writeSync(fd, "rec " + String(n).padStart(8, "0") + " " + "x".repeat(40) + "\\n")
  fs.fsyncSync(fd)
  n++
  fs.writeFileSync("/probe/fsynced", String(n))
  if (n % 20 === 0) fs.writeFileSync("/workspace/churn-" + (n % 7), crypto.randomBytes(40000))
}
`,
  )
  // One clone: replay the journal, check, and compare the records with what
  // was fsynced before the clone was taken. One line per clone.
  writeFileSync(
    path.join(probe, "check-one.sh"),
    `img=$1; n=$2; w=/tmp/w-$img; mkdir -p $w
cd /clones
e2fsck -fy "$img" > $w/fsck1 2>&1
e2fsck -fn "$img" > $w/fsck2 2>&1; clean=$?
repairs=$(awk 'NF { if ($0 ~ /\\? yes$/) { d = ($0 ~ /^[A-Za-z ]+\\? yes$/) ? prev : $0; print d } prev = $0 }' $w/fsck1 | grep -cvE '^Free (blocks|inodes) count wrong')
debugfs -R "dump /log.bin $w/log.bin" "$img" >/dev/null 2>&1
bad=$(head -n "$n" $w/log.bin | awk '!/^rec [0-9]{8} x{40}$/ { b++ } END { print b + 0 }')
have=$(wc -l < $w/log.bin)
echo "$img repairs=$repairs clean=$clean promised=$n have=$have bad=$bad"
rm -rf $w
`,
  )
  ensureFsckImage()
  // Small, so each check is quick: `e2fsck -f` walks every block group of a
  // volume, however little it holds. The journal is what is under test.
  const [program = "", ...args] = createVolume(volume, "4G")
  const created = await run(program, args)
  if (!created.ok)
    throw new Error(describeFailure("creating the volume", created))
  const writer = `pinetrie-contract-writer-${process.pid}`
  const fsynced = () =>
    Number(
      existsSync(path.join(probe, "fsynced"))
        ? readFileSync(path.join(probe, "fsynced"), "utf8").trim()
        : "0",
    )
  try {
    const t0 = Date.now()
    sh(
      `container run -d --init --name ${writer} -m 1G -v ${volume}:/workspace --mount type=bind,source=${probe},target=/probe docker.io/library/node:24-trixie-slim sleep infinity >/dev/null`,
    )
    const writing = new Promise<void>((resolve, reject) => {
      execFile(
        "container",
        ["exec", writer, "node", "/probe/writer.js"],
        error => (error === null ? resolve() : reject(error)),
      )
    })
    // Clones start once the writer is under way, and are taken back to back
    // with short random gaps while it writes (S41's soak, in small).
    await waitFor(() => fsynced() >= 100, 30_000)
    const t1 = Date.now()
    const promised: string[] = []
    for (let i = 0; i < CLONES; i++) {
      const count = fsynced()
      execFileSync("/bin/cp", ["-c", image, path.join(clones, `c${i}.img`)])
      promised.push(`c${i}.img ${count}`)
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150))
    }
    writeFileSync(path.join(probe, "stop"), "")
    await writing
    const t2 = Date.now()
    writeFileSync(path.join(clones, "promised"), `${promised.join("\n")}\n`)
    const checked = sh(
      `container run --rm -v ${clones}:/clones -v ${probe}:/probe ${FSCK_IMAGE} sh -c 'xargs -n 2 -P 4 sh /probe/check-one.sh < /clones/promised'`,
    )
    const t3 = Date.now()
    console.log(
      `  (contract: writer up in ${((t1 - t0) / 1000).toFixed(1)} s, ${CLONES} clones in ${((t2 - t1) / 1000).toFixed(1)} s, checked in ${((t3 - t2) / 1000).toFixed(1)} s)`,
    )
    const rows = checked.trim().split("\n")
    const good = rows.filter(row => {
      const f = Object.fromEntries(
        row
          .split(" ")
          .slice(1)
          .map(kv => kv.split("=")),
      ) as Record<string, string>
      return (
        f.repairs === "0" &&
        f.clean === "0" &&
        f.bad === "0" &&
        Number(f.have) >= Number(f.promised)
      )
    })
    check(
      "every clone of a journaled volume taken mid-write checks clean and holds every fsynced record",
      rows.length === CLONES && good.length === CLONES,
      `${good.length} of ${rows.length}`,
    )
    if (good.length !== rows.length)
      console.log(rows.filter(r => !good.includes(r)).join("\n"))
  } finally {
    sh(`container rm -f ${writer} >/dev/null 2>&1 || true`)
    sh(`container volume rm ${volume} >/dev/null 2>&1 || true`)
    rmSync(probe, { recursive: true, force: true })
  }
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

/**
 * A VM of the contract's own on the Mac: a state directory sharing the
 * built images and launchers, and a data disk of its own kept between runs
 * (`contract-data.img`), so a cold start formats it only the first time and
 * Docker keeps what it pulled. Its launcher stops 2 s after its last lease.
 * Returns how to put the environment back.
 */
function ownVm(): { readonly state: string; restore(): void } | null {
  if (process.platform !== "darwin") return null
  const real = vmStateDir(process.env, homedir())
  const state = realpathSync(mkdtempSync("/tmp/pc-"))
  const vm = path.join(state, "pinetrie", "vm")
  mkdirSync(vm, { recursive: true })
  for (const d of ["images", "bin"]) {
    mkdirSync(path.join(real, d), { recursive: true })
    symlinkSync(path.join(real, d), path.join(vm, d))
  }
  symlinkSync(path.join(real, "contract-data.img"), path.join(vm, "data.img"))
  const saved = {
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    LAUNCHER_IDLE_SECONDS: process.env.LAUNCHER_IDLE_SECONDS,
  }
  process.env.XDG_STATE_HOME = state
  process.env.LAUNCHER_IDLE_SECONDS = "2"
  return {
    state,
    restore() {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    },
  }
}

const median = (xs: readonly number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

/**
 * A server on the Mac's loopback, answering `mac <name>`, in a process of its
 * own: this one blocks while a lane connects (S136). Its port, and how to stop
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
  const own = ownVm()
  const onMac = process.platform === "darwin"
  const closedPort = await loopbackServer("closed")
  const grantedPort = await loopbackServer("granted")
  const logs: string[] = []
  const log = (l: string) => {
    logs.push(l)
    if (process.env.PINETRIE_E2E_LOG === "1") console.log(l)
  }
  const machine = { runtime: "docker", slots: null } as const
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
    dir: projA,
    defaultDirect: false,
    containers: true,
    machine,
    log,
  })
  const runtime = a?.runtime ?? null
  if (a === null || runtime === null)
    throw new Error(`no Docker runtime: ${JSON.stringify(a?.project)}`)
  const cold = /Docker answered (\d+) ms after the launcher started/.exec(
    logs.join("\n"),
  )?.[1]
  const lanes: LaneName[] = []
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
  ): Promise<LaneName> => {
    const name = laneNameForThread(`contract-${process.pid}-${lanes.length}`)
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
      ssh: false,
      nested: false,
      hostPorts: [],
    })
    runMs.push(Date.now() - started)
    return name
  }
  const runMs: number[] = []
  const laneRuntimes = new Map<LaneName, LaneRuntime>()
  const exec = (name: LaneName, script: string) => {
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
    // (the slot's fill sweeps through the disks helper's exec), so a broken
    // bridge fails here and not in a check after it. Only API calls come
    // before it: Docker's version, the slot's sweep, the pull. ──
    const echoed = quietCli(["run", "--rm", "-i", ALPINE_IMAGE, "cat"], "hi\n")
    check(
      "echo hi | docker run -i … cat returns hi: stdin's end reaches the lane, and its output comes back",
      echoed.trim() === "hi",
      JSON.stringify(echoed),
    )

    await a.ready({
      defaultImage: "",
      hostPorts: [grantedPort.port],
      mounts: mountsOfA,
    })
    for (const image of [NODE_IMAGE, PYTHON_IMAGE, ALPINE_IMAGE])
      await runtime.runInImage(image, ["true"])

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
      await new Promise(r => setTimeout(r, 20 + Math.random() * 80))
    }
    writeFileSync(path.join(probe, "stop"), "")
    await writing
    const disks = dockerDisks(projA)
    const holding = promised.filter(([id, count]) => {
      const out = inDisks(
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

    // ── the fence (S136): the Mac's loopback and gvproxy's API ──
    /** What a lane got from `url`: the server's answer, or wget's error. */
    const fetchFrom = async (name: LaneName, url: string) =>
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
      dir: projB,
      defaultDirect: false,
      containers: true,
      machine,
      log,
    })
    if (b?.runtime !== null && b !== null) {
      await b.ready({ defaultImage: "", hostPorts: [], mounts: mountsOfB })
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

    // ── another tool's VM (S135): a `container run` beside running lanes ──
    const containerUp =
      onMac &&
      quietSh("container system status >/dev/null 2>&1 && echo up").trim() ===
        "up"
    if (containerUp) {
      quietSh(
        "container run --rm docker.io/library/alpine:3.23 true >/dev/null 2>&1",
      )
      const lookup = await exec(
        writerLane,
        "nslookup registry-1.docker.io 2>&1 | tail -2",
      )
      check(
        "a container run on the Mac leaves running lanes on the network",
        /Address: \d+\.\d+/.test(lookup.stdout),
        lookup.stdout.trim().replace(/\n/g, " | "),
      )
    } else
      skip(
        "a container run on the Mac leaves running lanes on the network",
        onMac ? "Apple's container is not running" : "the Mac's VMs only",
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
