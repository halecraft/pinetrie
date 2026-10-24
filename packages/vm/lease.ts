// vm/lease — a host's lease on the lane VM. To a host the VM is a
// Docker socket and a slot of shared directories: it gathers what decides
// whether to start or join the VM (`planVm`), starts the launcher when need
// be, under the repair lock, takes a slot, and waits for Docker to answer;
// after a start of its own, its console's word on the data disk is read.
// And what the VM runs, asked without a lease (`gatherRunningVm`), and its
// stop for a repair (`stopVmForRepair`).

import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { mkdir, open, readFile } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import type { OnWaiting } from "@pinetrie/lock"
import {
  buildVmImageInVm,
  checkImageDir,
  gatherBuildFirst,
  gatherChangedFiles,
  readImageSources,
} from "./build.ts"
import { type DataDiskPlan, growDataDisk } from "./grow.ts"
import { ensureGvproxy, gvproxyPath, readGvproxyPin } from "./gvproxy.ts"
import {
  type Fill,
  imageDir,
  imageKey,
  isDiskFullAtLastBoot,
  launcherArgs,
  launcherFromCommandLine,
  otherHolders,
  planShares,
  planVm,
  planVmVersion,
  type ShareDir,
  type VmRefusal,
  vmBuildWords,
  vmKeptWords,
  vmStartRefusal,
  vmVersionWords,
  vmWords,
} from "./plan.ts"
import {
  decodeFromLauncher,
  encode,
  type FromLauncher,
  type LauncherRefusal,
  type RunningVm,
  type ToLauncher,
  type VmIdentity,
} from "./protocol.ts"
import { pruneVmState, runningLaunchers } from "./prune.ts"
import {
  type RepairLockHeld,
  repairLockStateDir,
  withRepairLock,
} from "./repair-lock.ts"
import { BUILDER, buildBinary, gatherBinary, LAUNCHER } from "./swift.ts"

export interface Lease {
  readonly slot: number
  /** The launcher's Docker socket on the Mac. */
  readonly docker: string
  /**
   * Share these directories in the slot, once per lease: refilling a slot
   * cuts every bind into it. `stop` runs first, with the slot, and the fill
   * waits for it: it must settle only once nothing the last host left bound
   * into the slot still runs, or the fill would cut those binds or give them
   * the new directories. Resolves when filled.
   */
  fill(
    dirs: readonly ShareDir[],
    stop: (slot: number) => Promise<unknown>,
  ): Promise<Fill>
  /** What the VM was started from, and how many leases it holds. */
  readonly identity: VmIdentity
  /**
   * Settles when the lease ends without `close`: the launcher stopped or
   * died, and the VM with it.
   */
  readonly ended: Promise<void>
  /**
   * Ask the launcher to stop the VM and exit, when this is its only lease
   * (else refused as `busy`); settles when the lease has ended.
   */
  retire(): Promise<void>
  /** Ends the lease; the slot empties. */
  close(): Promise<void>
}

/** Why a host has no lease, worded once. */
export class VmRefused extends Error {}

/** A launcher's refusal, with what would let it. */
export function launcherWords(r: LauncherRefusal): string {
  switch (r.reason) {
    case "full":
      return `all ${r.slots} slots of this Mac's lane VM are taken: stop a pine·trie host, or raise \`lanes.vm.slots\` (at most 20; it applies when the VM next starts)`
    case "filled":
      return "this host's slot in the lane VM is filled already"
    case "unleased":
      return "the lane VM was asked to fill a slot before leasing one"
    case "leased":
      return "the lane VM was asked for a second slot on one lease"
    case "share":
      return "the lane VM's launcher could not share this host's directories"
    case "boot":
      return `the lane VM did not start: ${r.detail}`
    case "busy":
      return `the lane VM was not replaced: ${r.leases - 1} other hosts hold leases on it`
    case "unreadable":
      return "the lane VM's launcher could not read this host's message"
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A connection to `socket`, or null when nothing answers there. */
export const connect = (socket: string): Promise<net.Socket | null> =>
  new Promise(resolve => {
    const s = net.createConnection(socket)
    s.once("connect", () => resolve(s))
    s.once("error", () => resolve(null))
  })

/** Whether Docker answers `/_ping` on `socket`. */
const pings = (socket: string): Promise<boolean> =>
  new Promise(resolve => {
    const req = http.get(
      { socketPath: socket, path: "/_ping", timeout: 2000 },
      res => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.once("error", () => resolve(false))
    req.once("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })

async function until<T>(
  what: string,
  ms: number,
  attempt: () => Promise<T | null | false>,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const got = await attempt()
    if (got !== null && got !== false) return got
    if (Date.now() > deadline)
      throw new Error(`${what} did not happen in ${ms / 1000} s`)
    await sleep(100)
  }
}

/**
 * A lease on this user's lane VM, starting it if it is not running. Refuses
 * with `VmRefused`, worded with what would let it.
 */
export async function leaseVm(input: LeaseInput): Promise<Lease> {
  const { lease, want, canStart } = await leaseOnce(input)
  const { identity } = lease
  const version = planVmVersion({
    running: identity,
    retirable: identity.image !== null,
    want,
    othersHolding: otherHolders(identity.leases, "host"),
    changedFiles: await gatherChangedFiles(input.stateDir, identity.image),
  })
  if (version.kind === "current") return lease
  if (version.kind !== "retire") {
    input.log(`[vm] ${vmVersionWords(version, "host")}`)
    return lease
  }
  if (canStart !== null) {
    input.log(`[vm] ${vmKeptWords(version.change, canStart)}`)
    return lease
  }
  // Built while the old VM still runs, so its lanes stop only for the swap.
  if (
    (await checkImageDir(path.join(input.stateDir, "images", want.image))) !==
    null
  )
    await buildImage(input)
  input.log(`[vm] ${vmVersionWords(version, "host")}`)
  await lease.retire()
  const control = path.join(input.stateDir, "control.sock")
  await until("the old lane VM stopping", 60_000, async () => {
    const s = await connect(control)
    s?.destroy()
    return s === null
  })
  return (await leaseOnce(input)).lease
}

/** A slot leased and filled for directories a host's own slot lacks. */
export interface ExtraLease {
  readonly fill: Fill
  /** Ends the lease; the slot empties. */
  close(): Promise<void>
}

/**
 * One more slot of the running VM, leased and filled with `dirs` alone, or
 * none, `stop` run first as `fill` runs it. Never starts, builds or retires
 * a VM: while the host's own lease is held, the launcher refuses to retire
 * the VM, so this joins the same one; a caller whose lease ended drops what
 * this gives it. It bridges no ssh socket; lanes keep the host slot's.
 */
export async function leaseExtra(input: {
  readonly stateDir: string
  readonly dirs: readonly ShareDir[]
  readonly stop: (slot: number) => Promise<unknown>
  readonly log: (line: string) => void
}): Promise<ExtraLease> {
  const socket = await connect(path.join(input.stateDir, "control.sock"))
  if (socket === null) throw new Error("the lane VM's launcher is gone")
  const lease = await leaseOn(socket, { agent: null, log: input.log })
  try {
    return {
      fill: await lease.fill(input.dirs, input.stop),
      close: lease.close,
    }
  } catch (error) {
    await lease.close().catch(() => {})
    throw error
  }
}

/** A build a lease runs before the VM starts, announced first. */
export type VmBuild =
  | { readonly kind: "vm-launcher" }
  | {
      readonly kind: "vm-image"
      /** Its builder compiled first. */
      readonly compile: boolean
      /** Alpine's kernel and root fetched first, once. */
      readonly fetch: boolean
    }

export interface LeaseInput {
  /** `vmStateDir`. */
  readonly stateDir: string
  /** The slots a VM this host starts boots with. */
  readonly slots: number
  /** The socket the slot's ssh socket is bridged to (the host's own ssh socket), or null. */
  readonly agent: string | null
  readonly log: (line: string) => void
  /** Told before each build; without it, each is logged in `vmBuildWords`. */
  readonly building?: (build: VmBuild) => void
  /** How large the data disk should be at a start this host makes; absent, it is left as it is. */
  readonly growData?: DataDiskPlan
  /**
   * Told once when a start must wait for the repair lock: another host is
   * starting the VM, or repairing its disk, which the caller words.
   */
  readonly onStartWaiting: OnWaiting
}

/**
 * One lease: on the running VM, else on one this host starts. With what the
 * host would start (`want`), and why it could not start it now (`canStart`,
 * null when it can).
 */
async function leaseOnce(input: LeaseInput): Promise<{
  readonly lease: Lease
  readonly want: { readonly image: string; readonly launcher: string }
  readonly canStart: string | null
}> {
  const { stateDir } = input
  await mkdir(stateDir, { recursive: true })
  const { first, image, launcher, planned, startRefusal } =
    await gatherVm(stateDir)
  if (planned.kind === "refused") throw refusedBy(planned.refusal)
  let socket = first
  let started: number | null = null
  if (planned.kind === "start") {
    // gather and plan what the launcher is started with
    const pin = await readGvproxyPin()
    const argv = launcherArgs({
      stateDir,
      image,
      slots: input.slots,
      macMemory: os.totalmem(),
      cpus: os.availableParallelism(),
      gvproxy: gvproxyPath(stateDir, pin),
    })
    // execute
    if (planned.buildImage) await buildImage(input)
    if (launcher.state === "buildable") {
      if (input.building === undefined)
        input.log("[vm] building the lane VM's launcher")
      else input.building({ kind: "vm-launcher" })
      await buildBinary(launcher.binary, LAUNCHER)
    }
    // The VM's network stack: fetched and checked once, then kept.
    await ensureGvproxy(stateDir, pin)
    const startedVm = await startLaneVm(input, {
      binary: launcher.binary,
      argv,
    })
    socket = startedVm.socket
    started = startedVm.started
  }
  if (socket === null) throw new Error("the lane VM's launcher is gone")
  const lease =
    started === null
      ? await leaseOn(socket, input)
      : await leaseStartedVm(socket, input, started)
  return {
    lease,
    want: {
      image: path.basename(image),
      launcher: path.basename(launcher.binary),
    },
    canStart: startRefusal === null ? null : vmWords(startRefusal),
  }
}

const refusedBy = (r: VmRefusal) => new VmRefused(vmWords(r))

/**
 * The VM this host started found its data disk full at boot (`init`'s
 * `data disk full`): a repair's to deal with, not a lease's.
 */
export class DiskFullAtBoot extends Error {
  constructor() {
    super("the lane VM's data disk is full: its console says so at this boot")
  }
}

/**
 * A lease on the VM this host just started, its console read after,
 * whether Docker answered or not: Docker may answer on a full disk and
 * fail every write after (then the lease is closed), or stay silent. Its
 * console's `data disk full` fails it as `DiskFullAtBoot`.
 */
export async function leaseStartedVm(
  socket: net.Socket,
  input: Pick<LeaseInput, "stateDir" | "agent" | "log"> & {
    readonly dockerMs?: number
  },
  started: number,
): Promise<Lease> {
  const lease = await leaseOn(socket, input).catch(async (error: unknown) => {
    if (await isDataDiskFull(input.stateDir)) throw new DiskFullAtBoot()
    throw error
  })
  input.log(
    `[vm] Docker answered ${Date.now() - started} ms after the launcher started`,
  )
  if (await isDataDiskFull(input.stateDir)) {
    await lease.close()
    throw new DiskFullAtBoot()
  }
  return lease
}

/** The VM's own logs in its state directory: its console, and the launcher's output. */
export type VmLog = "console.log" | "launcher.log"

/** How much of a log's end `readVmLogTail` reads: both grow for as long as the state directory lives. */
const TAIL_BYTES = 64 * 1024

/**
 * The last `lines` lines of one of the VM's logs, read from its last 64 KiB
 * only; null where it is not there.
 */
export async function readVmLogTail(
  stateDir: string,
  file: VmLog,
  lines: number,
): Promise<readonly string[] | null> {
  const handle = await open(path.join(stateDir, file), "r").catch(() => null)
  if (handle === null) return null
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const read = buffer.toString("utf8").split("\n")
    // Read from inside a line: its start is cut, so it is dropped.
    if (length < size) read.shift()
    if (read.at(-1) === "") read.pop()
    return read.slice(-lines)
  } finally {
    await handle.close()
  }
}

/** Whether the console's last boot says the data disk is full; a console not there says nothing. */
const isDataDiskFull = async (stateDir: string): Promise<boolean> =>
  isDiskFullAtLastBoot(
    await readFile(path.join(stateDir, "console.log"), "utf8").catch(() => ""),
  )

/**
 * The VM started, under the repair lock: waited for while another host
 * starts the VM or repairs its disk (`onStartWaiting`), then `startVm`.
 */
export async function startLaneVm(
  input: LeaseInput,
  launcher: { readonly binary: string; readonly argv: readonly string[] },
): Promise<{ readonly socket: net.Socket; readonly started: number | null }> {
  const done = await withRepairLock(
    input.stateDir,
    input.onStartWaiting,
    held => startVm(held, { input, ...launcher }),
  )
  if (done.kind === "failed")
    throw new Error(
      `the lane VM was not started: its repair lock could not be taken: ${done.detail}`,
    )
  return done.value
}

/**
 * Grow the data disk and start the launcher, under the repair lock, so no
 * VM starts, and no disk grows, while a repair has it. A launcher that
 * answers by now was started by another host while this one waited: it is
 * joined, and nothing grows. Returns the launcher's control socket, and
 * when this host started it (null when it joined).
 */
async function startVm(
  _held: RepairLockHeld,
  f: {
    readonly input: LeaseInput
    readonly binary: string
    readonly argv: readonly string[]
  },
): Promise<{ readonly socket: net.Socket; readonly started: number | null }> {
  const { input } = f
  const { stateDir } = input
  const control = path.join(stateDir, "control.sock")
  const answering = await connect(control)
  if (answering !== null) return { socket: answering, started: null }
  // Before the launcher: the guest resizes into it at this boot.
  if (input.growData !== undefined) {
    const grown = await growDataDisk(
      path.join(stateDir, "data.img"),
      stateDir,
      input.growData,
    )
    if (grown !== null)
      input.log(
        `[vm] the lanes' disk grows from ${gib(grown.from)} to ${gib(grown.to)} GiB at this start`,
      )
  }
  const out = openSync(path.join(stateDir, "launcher.log"), "a")
  const started = Date.now()
  spawn(f.binary, [...f.argv], {
    detached: true,
    stdio: ["ignore", out, out],
  }).unref()
  input.log("[vm] starting the lane VM")
  const socket = await until("the lane VM's launcher answering", 30_000, () =>
    connect(control),
  )
  return { socket, started }
}

/**
 * Stop the VM and its launcher for a repair, whatever leases it holds:
 * every host's lease ends. Settles once the launcher has closed this
 * connection, as it does exiting; at once when none runs. A launcher
 * older than the message refuses it, said.
 */
export async function stopVmForRepair(held: RepairLockHeld): Promise<void> {
  const socket = await connect(
    path.join(repairLockStateDir(held), "control.sock"),
  )
  if (socket === null) return
  const channel = launcherChannel(socket)
  try {
    channel.send({ kind: "stop-for-repair" })
    const m = await channel.next("a stop for a repair", 60_000)
    if (m?.kind === "refused") throw new VmRefused(launcherWords(m))
    await channel.closed
  } finally {
    socket.destroy()
  }
}

/** Bytes as whole GiB, for the log. */
const gib = (bytes: number) => Math.round(bytes / 1024 ** 3)

/** Build the current image, saying first what that takes, then prune what it replaced. */
async function buildImage(input: LeaseInput): Promise<void> {
  const { stateDir } = input
  const first = await gatherBuildFirst(stateDir)
  if (input.building === undefined)
    input.log(`[vm] ${vmBuildWords({ kind: "build" }, first)}`)
  else input.building({ kind: "vm-image", ...first })
  await buildVmImageInVm({
    stateDir,
    force: false,
    log: l => input.log(`[vm] ${l}`),
  })
  await pruneVmState(stateDir)
}

/** What decides whether a host starts the VM, joins it, or cannot: gathered, then planned. */
async function gatherVm(stateDir: string) {
  const image = imageDir(stateDir, imageKey(await readImageSources()))
  const first = await connect(path.join(stateDir, "control.sock"))
  const [launcher, builder] = await Promise.all([
    gatherBinary(stateDir, LAUNCHER),
    gatherBinary(stateDir, BUILDER),
  ])
  const facts = {
    platform: process.platform,
    arch: process.arch,
    darwin: Number(os.release().split(".")[0]),
    answering: first !== null,
    image: (await checkImageDir(image)) === null,
    launcher: launcher.state,
    builder: builder.state,
  }
  return {
    first,
    image,
    launcher,
    planned: planVm(facts),
    startRefusal: vmStartRefusal(facts),
  }
}

/**
 * Why a lease on this user's VM would be refused, or null, without taking
 * one: nothing is started, built or joined. For a check that must leave
 * the person's VM alone, as the suites' `runtimeProblem` must.
 */
export async function vmProblem(stateDir: string): Promise<string | null> {
  const { first, planned } = await gatherVm(stateDir)
  first?.destroy()
  return planned.kind === "refused" ? vmWords(planned.refusal) : null
}

/** How long a launcher may take to answer `status`. */
const STATUS_MS = 5_000

/**
 * What the lane VM of `stateDir` runs, asked without a lease: `status`
 * takes no slot, so it starts no VM and holds none from its idle stop. A
 * launcher that refuses it is older, and is read from `ps`.
 */
export async function gatherRunningVm(stateDir: string): Promise<RunningVm> {
  const socket = await connect(path.join(stateDir, "control.sock"))
  if (socket === null) return { kind: "none" }
  const channel = launcherChannel(socket)
  try {
    channel.send({ kind: "status" })
    const m = await channel.next("a status", STATUS_MS)
    if (m === null) return { kind: "none" }
    if (m.kind === "status")
      return {
        kind: "running",
        image: m.image,
        launcher: m.launcher,
        leases: m.leases,
      }
    if (m.kind !== "refused")
      throw new Error(`the lane VM's launcher answered a status with ${m.kind}`)
    const named =
      (await runningLaunchers())
        ?.map(line => launcherFromCommandLine(line, stateDir))
        .find(l => l !== null) ?? null
    return {
      kind: "running",
      image: named?.image ?? null,
      launcher: named?.launcher ?? null,
      leases: null,
    }
  } finally {
    socket.destroy()
  }
}

/**
 * The launcher's side of one connection: its messages in order, each
 * awaited with a deadline. A line that is no launcher message is skipped.
 */
function launcherChannel(socket: net.Socket): {
  send(message: ToLauncher): void
  /**
   * The next message, or null when the connection ended. Waits at most
   * `ms`, then fails naming `what`: a launcher that never answers must not
   * hang the host's start.
   */
  next(what: string, ms: number): Promise<FromLauncher | null>
  /** `next`, throwing on an end or a refusal (`VmRefused`, worded by `launcherWords`). */
  reply(what: string, ms: number): Promise<FromLauncher>
  readonly closed: Promise<void>
} {
  const lines = createInterface({ input: socket })
  const queue: FromLauncher[] = []
  const waiters: ((m: FromLauncher | null) => void)[] = []
  let ended = false
  lines.on("line", line => {
    const message = decodeFromLauncher(line)
    if (message === null) return
    const w = waiters.shift()
    if (w === undefined) queue.push(message)
    else w(message)
  })
  const closed = new Promise<void>(resolve =>
    socket.once("close", () => {
      ended = true
      for (const w of waiters.splice(0)) w(null)
      resolve()
    }),
  )
  socket.on("error", () => {})
  const next = (what: string, ms: number): Promise<FromLauncher | null> => {
    if (queue.length > 0) return Promise.resolve(queue.shift() ?? null)
    if (ended) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const waiter = (m: FromLauncher | null) => {
        clearTimeout(timer)
        resolve(m)
      }
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1)
        reject(
          new Error(
            `the lane VM's launcher did not answer ${what} in ${ms / 1000} s`,
          ),
        )
      }, ms)
      waiters.push(waiter)
    })
  }
  return {
    send: message => {
      socket.write(encode(message))
    },
    next,
    async reply(what, ms) {
      const m = await next(what, ms)
      if (m === null) throw new Error("the lane VM's launcher closed the lease")
      if (m.kind === "refused") throw new VmRefused(launcherWords(m))
      return m
    },
    closed,
  }
}

export async function leaseOn(
  socket: net.Socket,
  input: {
    readonly agent: string | null
    readonly log: (l: string) => void
    /** How long a lease's reply may take: 30 s unless a test says. */
    readonly replyMs?: number
    /** How long Docker may take to answer: 60 s unless a test says. */
    readonly dockerMs?: number
  },
): Promise<Lease> {
  const { send, next, reply, closed } = launcherChannel(socket)
  input.log("[vm] asking the lane VM's launcher for a slot")
  send({ kind: "lease", agent: input.agent })
  const slot = await reply("a lease", input.replyMs ?? 30_000).catch(error => {
    socket.destroy()
    throw error
  })
  if (slot.kind !== "slot") throw new Error("the lane VM gave no slot")
  input.log(`[vm] this host has slot ${slot.slot} of the lane VM`)
  await until("Docker answering in the lane VM", input.dockerMs ?? 60_000, () =>
    pings(slot.docker),
  )
  let filled = false
  let closing = false
  // Not `close`'s: the launcher stopped or died, and the VM with it.
  const endedUnasked = closed.then(() =>
    closing ? new Promise<void>(() => {}) : undefined,
  )
  return {
    slot: slot.slot,
    docker: slot.docker,
    identity: {
      image: slot.image,
      launcher: slot.launcher,
      leases: slot.leases,
    },
    ended: endedUnasked,
    async retire() {
      closing = true
      send({ kind: "retire" })
      const m = await next("a retire", 60_000)
      if (m?.kind === "refused") {
        closing = false
        throw new VmRefused(launcherWords(m))
      }
      await closed
    },
    async fill(dirs, stop) {
      if (filled) throw new Error("a slot is filled once")
      filled = true
      await stop(slot.slot)
      const entries = planShares(dirs)
      send({ kind: "fill", entries })
      const m = await reply("a fill", 30_000)
      if (m.kind !== "filled")
        throw new Error("the lane VM did not fill the slot")
      return { slot: slot.slot, entries }
    },
    async close() {
      closing = true
      socket.end()
      await closed
    },
  }
}
