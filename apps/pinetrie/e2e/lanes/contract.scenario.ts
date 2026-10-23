// e2e/lanes/contract — what the Docker runtime must hold that no unit test can
// show: snapshots under writes, the working copy read-only on the Mac's side, a
// half-close through the launcher, no vsock from a lane, two hosts' slots
// apart, the images a host keeps: Docker's refusal to remove one a
// container uses, and a create refused for a missing image; and the machine
// as lanehost's disks role reads it: the lane VM's pressure, a lane's cgroup. On the Mac it runs a VM of its own, from this checkout's launcher and
// the built image, so a change to the launcher is what runs, and the person's
// hosts are untouched.

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
  deletableSnapshot,
  errorText,
  type SnapshotId,
  type ThreadId,
  threadIdFor,
} from "@pinetrie/core"
import { entrySnapshotId } from "@pinetrie/core/fixtures"
import { LANEHOST_LABEL, NESTED_MOUNT, projectKey } from "@pinetrie/docker"
import { PINETRIE_MOUNT, thisInstall } from "@pinetrie/install"
import {
  ensureRuntime,
  executeOrThrow,
  type LaneRuntime,
  laneContainer,
  type Mount,
  planSnapshot,
  prepareImages,
  RUNTIME_MOUNT,
  run,
} from "@pinetrie/lanes"
import { GVPROXY_HOST_ADDRESS } from "@pinetrie/vm"
import { findProject } from "../../host/work/runtime.ts"
import { PLAYWRIGHT_VERSION } from "../../host/work/setup.ts"
import type { Checks } from "../checks.ts"
import { CommandFailed } from "../command.ts"
import { committedProject, filterAsync, waitFor } from "../harness.ts"
import { suiteSessionFiles } from "../lane-hosts.ts"
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
  const projA = await committedProject("pinetrie-contract-a-", {
    "README.md": "a\n",
  })
  const projB = await committedProject("pinetrie-contract-b-", {
    "README.md": "b\n",
  })
  mkdirSync(path.join(projA, ".plans"))
  const probe = realpathSync(
    mkdtempSync(path.join(tmpdir(), "pinetrie-probe-")),
  )
  writeFileSync(path.join(probe, "writer.js"), WRITER)
  await ownForInnerLanes(probe)
  await ownForInnerLanes(path.join(projA, ".plans"))
  const a = await findProject({
    root: projA,
    install: thisInstall,
    slots,
    // No lane here holds an ssh identity: nothing listens there.
    hostSocket: path.join(projA, ".no-ssh.sock"),
    log,
    building: build => log(`building ${JSON.stringify(build)}`),
  })
  if (a?.kind !== "found")
    throw new Error(`no Docker runtime: ${a === null ? "no project" : a.words}`)
  const { runtime } = a
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
      states: false,
    })
    return name
  }
  const laneRuntimes = new Map<ThreadId, LaneRuntime>()
  const contractImage = (name: string) =>
    `pinetrie-lane:contract-${process.pid}-${name}`
  const heldContainer = `pinetrie-contract-${process.pid}-held`
  const imagesDir = realpathSync(
    mkdtempSync(path.join(tmpdir(), "pinetrie-images-")),
  )
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
    const echoed = await quietCli(
      ["run", "--rm", "-i", ALPINE_IMAGE, "cat"],
      "hi\n",
    )
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
      PLAYWRIGHT_VERSION,
    )
    const serverMounts: readonly Mount[] = [
      { source: thisInstall.root, target: PINETRIE_MOUNT, readonly: true },
      {
        source: await ensureRuntime(
          runtime,
          suiteSessionFiles(projA).lanes.runtime,
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

    // ── the images a host needs: after a build, pine·trie's others that no
    // container uses go; and a tag removed under it is built again ──
    const imageFor = (name: string) =>
      `FROM ${ALPINE_IMAGE}\nLABEL pinetrie.contract=${process.pid}-${name}\n`
    for (const name of ["unused", "held"])
      await quietCli(
        ["buildx", "build", "--load", "-t", contractImage(name), "-"],
        imageFor(name),
      )
    await quietCli([
      "create",
      "--name",
      heldContainer,
      contractImage("held"),
      "true",
    ])
    writeFileSync(path.join(imagesDir, "Containerfile"), imageFor("rebuilt"))
    const rebuilt = {
      file: path.join(imagesDir, "Containerfile"),
      tag: contractImage("rebuilt"),
      buildArgs: [],
    }
    await runtime.ensureLaneImages([rebuilt])
    const listed = await quietCli([
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ])
    check(
      "after a build, an image of pine·trie's no container uses is removed, and one a stopped container uses stays",
      !listed.includes(contractImage("unused")) &&
        listed.includes(contractImage("held")),
      listed
        .split("\n")
        .filter(t => t.includes("contract"))
        .join(", "),
    )
    await quietCli(["rmi", rebuilt.tag])
    // A create that fails is the check's failure, not the scenario's error.
    const up = await lane(rebuilt.tag).then(
      made => exec(made, "echo up"),
      (error: unknown) => ({ stdout: "", stderr: String(error) }),
    )
    check(
      "a lane whose image another host removed is made, its image built again",
      up.stdout.trim() === "up",
      `${up.stdout}${up.stderr}`,
    )

    // ── lanehost's privileged role: the host's grant made it ──
    const privileged = (
      await quietCli([
        "ps",
        "--filter",
        `label=pinetrie.project=${projectKey(projA)}`,
        "--filter",
        `label=${LANEHOST_LABEL}=privileged`,
        "--format",
        "{{.Names}}",
      ])
    ).trim()
    if (privileged === "")
      skip(
        "lanehost's privileged role cannot write the lanes directory",
        "nothing here needs the privileged role: no grant of the host's ports, and no diff by send under rootless Docker",
      )
    else {
      const wrote = await quietCli([
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

    // ── the machine, as lanehost's disks role reads it for its health ──
    const sampled = await a.machine
      .runningLanes()
      .then(async running => ({
        running,
        read: await a.machine.machineSample(running.map(r => r.id)),
      }))
      .catch((error: unknown) => errorText(error))
    const sampleDetail = (
      words: (s: Exclude<typeof sampled, string>) => string,
    ): string => (typeof sampled === "string" ? sampled : words(sampled))
    if (onMac)
      check(
        "the lane VM's kernel reports memory pressure",
        typeof sampled !== "string" && sampled.read.pressure !== null,
        sampleDetail(s => JSON.stringify(s.read.pressure)),
      )
    else
      skip(
        "the lane VM's kernel reports memory pressure",
        "the lane VM is the Mac's: on Linux the kernel is the machine's, and pine·trie sets none of it",
      )
    if (existsSync(NESTED_MOUNT))
      skip(
        "lanehost's disks role reads each running lane's memory from its cgroup",
        "under rootless Docker no role is given the cgroup tree",
      )
    else
      check(
        "lanehost's disks role reads each running lane's memory from its cgroup",
        typeof sampled !== "string" &&
          sampled.running.length > 0 &&
          sampled.read.containers.every(
            c => c.memory !== null && c.memory.current > 0,
          ),
        sampleDetail(
          s =>
            `${s.running.length} running: ${JSON.stringify(s.read.containers.map(c => c.memory?.current ?? null))}`,
        ),
      )

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
    const runners = {
      runtime,
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
      const id = entrySnapshotId(i, process.pid)
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
    const holding = await filterAsync(promised, async ([id, count]) => {
      const out = await inDisks(
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
    const diffFrom = entrySnapshotId(SNAPSHOTS, process.pid)
    const diffTo = entrySnapshotId(SNAPSHOTS + 1, process.pid)
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
      const source = (
        await cli([
          "inspect",
          "-f",
          '{{range .Mounts}}{{if eq .Destination "/mnt/host-working-copy"}}{{.Source}}{{end}}{{end}}',
          laneContainer(writerLane),
        ])
      ).trim()
      capped = await quietCli([
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
      install: thisInstall,
      slots,
      hostSocket: path.join(projB, ".no-ssh.sock"),
      log,
      building: build => log(`building ${JSON.stringify(build)}`),
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

    // ── one host per project: its disks server holds the project's lock ──
    const second = await findProject({
      root: projA,
      install: thisInstall,
      slots,
      hostSocket: path.join(projA, ".no-ssh.sock"),
      log,
      building: build => log(`building ${JSON.stringify(build)}`),
    })
    const refusal =
      second?.kind === "found"
        ? await second
            .ready({
              defaultImage: "",
              hostPorts: [],
              mounts: [...mountsOfA, ...serverMounts],
            })
            .then(
              () => "served",
              (error: unknown) => errorText(error),
            )
        : `no runtime: ${second === null ? "no project" : second.words}`
    if (second?.kind === "found") await second.close()
    const firstServes = await runtime.snapshots().then(
      () => "serves",
      (error: unknown) => errorText(error),
    )
    check(
      "a second host on a served project is refused",
      refusal.includes("another pine·trie host serves this project's lanes") &&
        firstServes === "serves",
      `the second: ${refusal} | the first: ${firstServes}`,
    )

    // A dead server's lock goes with its child: the host's next call takes
    // it again, once that child has exited.
    // Every disks container of the project's: on the Mac the refused host's
    // is left in its slot, and only the first host's server holds the lock.
    const disksContainers = (
      await cli([
        "ps",
        "--filter",
        `label=pinetrie.project=${projectKey(projA)}`,
        "--filter",
        `label=${LANEHOST_LABEL}=disks`,
        "--format",
        "{{.Names}}",
      ])
    )
      .split("\n")
      .filter(n => n.trim() !== "")
    let killed = 0
    for (const c of disksContainers) {
      const out = await cli([
        "exec",
        c,
        "sh",
        "-c",
        // Bracketed, so the pattern matches no shell that holds it.
        'n=$(pgrep -f "[s]erver.ts disks" | wc -l); pkill -9 -f "[s]erver.ts disks"; echo $n',
      ]).catch(() => "0")
      killed += Number(out.trim()) || 0
    }
    let refusedAfterKill = 0
    const tookBack = await waitFor(
      () =>
        runtime.snapshots().then(
          () => true,
          () => {
            refusedAfterKill++
            return false
          },
        ),
      30_000,
    ).catch(() => -1)
    check(
      "a disks server killed with SIGKILL frees its project's lock: its host's next call takes it back",
      killed > 0 && tookBack >= 0,
      `killed ${killed} servers in ${disksContainers.length} containers, then refused ${refusedAfterKill} times`,
    )

    // ── the VM stops under a running host: it leases again ──
    if (own !== null) {
      const before = logs.length
      await quietSh(`pkill -TERM -f 'launcher-.* ${own.state}' || true`)
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

    // ── a service killed for memory, heard from Docker's events ──
    // Last: the kill may take the disks role's server, which the next call
    // starts again.
    if (existsSync(NESTED_MOUNT))
      skip(
        "Docker's events name lanehost's disks role killed for memory",
        "no spike has measured rootless Docker's oom events",
      )
    else {
      const kills = a.machine.watchServiceKills()
      try {
        const heard: string[] = [...(await kills.take())]
        // Past the role's 256 MiB: busybox's tail holds a line with no end.
        const hog = await inDisks(projA, "tail /dev/zero")
        await waitFor(async () => {
          heard.push(...(await kills.take()))
          return heard.includes("disks")
        }, 30_000).catch(() => -1)
        check(
          "Docker's events name lanehost's disks role killed for memory",
          heard.includes("disks"),
          `heard ${JSON.stringify(heard)} | the hog: ${hog.trim().slice(-200)}`,
        )
      } finally {
        kills.close()
      }
    }
  } finally {
    for (const l of lanes) {
      const on = laneRuntimes.get(l) ?? runtime
      await on.remove(laneContainer(l)).catch(() => {})
      await on.disk({ kind: "delete", lane: l }).catch(() => {})
    }
    // After the lanes: a lane's container holds its image.
    await quietCli(["rm", "-f", heldContainer])
    for (const name of ["unused", "held", "rebuilt"])
      await quietCli(["rmi", contractImage(name)])
    rmSync(imagesDir, { recursive: true, force: true })
    closedPort.stop()
    grantedPort.stop()
    await runtime
      .disk({
        kind: "delete-snapshots",
        ids: snapshots.map(s => deletableSnapshot("entry", s)),
      })
      .catch(() => {})
    await a.close()
    if (own !== null) {
      // The contract's VM stops once its last lease ends.
      await waitFor(
        async () =>
          (await quietSh(`pgrep -f '${own.state}' || true`)).trim() === "",
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
const quietCli = (args: readonly string[], input?: string): Promise<string> =>
  cli(args, input).catch((error: unknown) =>
    error instanceof CommandFailed
      ? `${error.stdout}${error.stderr}`
      : Promise.reject(error),
  )

const quietSh = (script: string): Promise<string> => sh(script).catch(() => "")
