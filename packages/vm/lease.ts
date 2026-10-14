// vm/lease — a host's lease on the lane VM. To a host the VM is a
// Docker socket and a slot of shared directories: it gathers what decides
// whether to start or join the VM (`planVm`), starts the launcher when need
// be, takes a slot, and waits for Docker to answer.

import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import {
  buildVmImageInVm,
  checkImageDir,
  gatherBuildFirst,
  readImageSources,
} from "./build.ts"
import { ensureGvproxy, readGvproxyPin } from "./gvproxy.ts"
import {
  type Fill,
  imageDir,
  imageKey,
  OLD_LAUNCHER_WORDS,
  planShares,
  planVm,
  planVmVersion,
  type ShareDir,
  staleVmWords,
  type VmRefusal,
  vmBuildWords,
  vmMemory,
  vmStartRefusal,
  vmWords,
} from "./plan.ts"
import {
  decodeFromLauncher,
  encode,
  type FromLauncher,
  type LauncherRefusal,
  type VmIdentity,
} from "./protocol.ts"
import { pruneVmState } from "./prune.ts"
import { BUILDER, buildBinary, gatherBinary, LAUNCHER } from "./swift.ts"

export interface Lease {
  readonly slot: number
  /** The launcher's Docker socket on the Mac. */
  readonly docker: string
  /**
   * Share these directories in the slot, once per lease: refilling a slot
   * cuts every bind into it. `sweep` runs first, with the slot: it removes
   * what a host that died holding the slot left bound into it, which the
   * fill would give the new directories. Resolves when filled.
   */
  fill(
    dirs: readonly ShareDir[],
    sweep: (slot: number) => Promise<void>,
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
  const version = planVmVersion(lease.identity, want)
  if (version.kind === "current") return lease
  if (version.kind === "old-launcher") {
    input.log(`[vm] ${OLD_LAUNCHER_WORDS}`)
    return lease
  }
  if (version.kind === "stale") {
    input.log(`[vm] ${staleVmWords(version.leases, want.image)}`)
    return lease
  }
  if (canStart !== null) {
    input.log(
      `[vm] the lane VM runs an older image or launcher, kept: ${canStart}`,
    )
    return lease
  }
  // Built while the old VM still runs, so its lanes stop only for the swap.
  if (
    (await checkImageDir(path.join(input.stateDir, "images", want.image))) !==
    null
  )
    await buildImage(input)
  input.log("[vm] replacing the lane VM, which runs an older image or launcher")
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
 * One more slot of the running VM, leased, swept and filled with `dirs`
 * alone, or none. Never starts, builds or retires a VM: while the host's
 * own lease is held, the launcher refuses to retire the VM, so this joins
 * the same one; a caller whose lease ended drops what this gives it. It
 * bridges no ssh socket; lanes keep the host slot's.
 */
export async function leaseExtra(input: {
  readonly stateDir: string
  readonly dirs: readonly ShareDir[]
  readonly sweep: (slot: number) => Promise<void>
  readonly log: (line: string) => void
}): Promise<ExtraLease> {
  const socket = await connect(path.join(input.stateDir, "control.sock"))
  if (socket === null) throw new Error("the lane VM's launcher is gone")
  const lease = await leaseOn(socket, { agent: null, log: input.log })
  try {
    return {
      fill: await lease.fill(input.dirs, input.sweep),
      close: lease.close,
    }
  } catch (error) {
    await lease.close().catch(() => {})
    throw error
  }
}

interface LeaseInput {
  /** `vmStateDir`. */
  readonly stateDir: string
  /** The slots a VM this host starts boots with. */
  readonly slots: number
  /** The socket the slot's ssh socket is bridged to (the host's own ssh socket), or null. */
  readonly agent: string | null
  readonly log: (line: string) => void
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
  const control = path.join(stateDir, "control.sock")
  const { first, image, launcher, planned, startRefusal } =
    await gatherVm(stateDir)
  // execute
  if (planned.kind === "refused") throw refusedBy(planned.refusal)
  let socket = first
  let started: number | null = null
  if (planned.kind === "start") {
    if (planned.buildImage) await buildImage(input)
    if (launcher.state === "buildable") {
      input.log("[vm] building the lane VM's launcher")
      await buildBinary(launcher.binary, LAUNCHER)
    }
    // The VM's network stack: fetched and checked once, then kept.
    const gvproxy = await ensureGvproxy(stateDir, await readGvproxyPin())
    const out = openSync(path.join(stateDir, "launcher.log"), "a")
    started = Date.now()
    spawn(
      launcher.binary,
      [
        stateDir,
        image,
        String(input.slots),
        String(vmMemory(os.totalmem())),
        String(os.availableParallelism()),
        gvproxy,
      ],
      { detached: true, stdio: ["ignore", out, out] },
    ).unref()
    input.log("[vm] starting the lane VM")
    socket = await until("the lane VM's launcher answering", 30_000, () =>
      connect(control),
    )
  }
  if (socket === null) throw new Error("the lane VM's launcher is gone")
  const lease = await leaseOn(socket, input)
  if (started !== null)
    input.log(
      `[vm] Docker answered ${Date.now() - started} ms after the launcher started`,
    )
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

/** Build the current image, saying first what that takes, then prune what it replaced. */
async function buildImage(input: LeaseInput): Promise<void> {
  const { stateDir } = input
  input.log(
    `[vm] ${vmBuildWords({ kind: "build" }, await gatherBuildFirst(stateDir))}`,
  )
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

export async function leaseOn(
  socket: net.Socket,
  input: {
    readonly agent: string | null
    readonly log: (l: string) => void
    /** How long a lease's reply may take: 30 s unless a test says. */
    readonly replyMs?: number
  },
): Promise<Lease> {
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
  /**
   * The launcher's next message, or null when the lease ended. Waits at most
   * `ms`, then fails naming `what`: a launcher that never answers must not
   * hang the host's start.
   */
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
  const reply = async (what: string, ms: number): Promise<FromLauncher> => {
    const m = await next(what, ms)
    if (m === null) throw new Error("the lane VM's launcher closed the lease")
    if (m.kind === "refused") throw new VmRefused(launcherWords(m))
    return m
  }

  input.log("[vm] asking the lane VM's launcher for a slot")
  socket.write(encode({ kind: "lease", agent: input.agent }))
  const slot = await reply("a lease", input.replyMs ?? 30_000).catch(error => {
    socket.destroy()
    throw error
  })
  if (slot.kind !== "slot") throw new Error("the lane VM gave no slot")
  input.log(`[vm] this host has slot ${slot.slot} of the lane VM`)
  await until("Docker answering in the lane VM", 60_000, () =>
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
      socket.write(encode({ kind: "retire" }))
      const m = await next("a retire", 60_000)
      if (m?.kind === "refused") {
        closing = false
        throw new VmRefused(launcherWords(m))
      }
      await closed
    },
    async fill(dirs, sweep) {
      if (filled) throw new Error("a slot is filled once")
      filled = true
      await sweep(slot.slot)
      const entries = planShares(dirs)
      socket.write(encode({ kind: "fill", entries }))
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
