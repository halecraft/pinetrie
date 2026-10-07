// vm/lease — a host's lease on the lane VM (ADR-0103). To a host the VM is a
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
import { checkImageDir, readImageSources } from "./build.ts"
import { ensureGvproxy, readGvproxyPin } from "./gvproxy.ts"
import { buildLauncher, gatherLauncher } from "./launcher.ts"
import {
  imageDir,
  imageKey,
  planShares,
  planVm,
  type VmRefusal,
  vmMemory,
  vmWords,
} from "./plan.ts"
import {
  decodeFromLauncher,
  encode,
  type FromLauncher,
  type LauncherRefusal,
} from "./protocol.ts"

export interface Lease {
  readonly slot: number
  /** The launcher's Docker socket on the Mac. */
  readonly docker: string
  /**
   * Share these directories in the slot, once; resolves when filled, with
   * where each is in the VM (`planShares`).
   */
  fill(
    dirs: readonly { readonly source: string; readonly readOnly: boolean }[],
  ): Promise<{ readonly pathOf: (source: string) => string }>
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
export async function leaseVm(input: {
  /** `vmStateDir`. */
  readonly stateDir: string
  /** The slots a VM this host starts boots with. */
  readonly slots: number
  /** This host's SSH_AUTH_SOCK, or null. */
  readonly agent: string | null
  readonly log: (line: string) => void
}): Promise<Lease> {
  const { stateDir } = input
  await mkdir(stateDir, { recursive: true })
  const control = path.join(stateDir, "control.sock")
  const { first, image, launcher, planned } = await gatherVm(stateDir)
  // execute
  if (planned.kind === "refused") throw refusedBy(planned.refusal)
  let socket = first
  let started: number | null = null
  if (planned.kind === "start") {
    if (launcher.state === "buildable") {
      input.log("[vm] building the lane VM's launcher")
      await buildLauncher(launcher.binary)
    }
    // The VM's network (S136): fetched and checked once, then kept.
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
  return lease
}

const refusedBy = (r: VmRefusal) => new VmRefused(vmWords(r))

/** What decides whether a host starts the VM, joins it, or cannot: gathered, then planned. */
async function gatherVm(stateDir: string) {
  const image = imageDir(stateDir, imageKey(await readImageSources()))
  const first = await connect(path.join(stateDir, "control.sock"))
  const launcher = await gatherLauncher(stateDir)
  const planned = planVm({
    platform: process.platform,
    arch: process.arch,
    darwin: Number(os.release().split(".")[0]),
    answering: first !== null,
    image: (await checkImageDir(image)) === null,
    launcher: launcher.state,
  })
  return { first, image, launcher, planned }
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
  input: { readonly agent: string | null; readonly log: (l: string) => void },
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
  const next = (): Promise<FromLauncher | null> =>
    queue.length > 0
      ? Promise.resolve(queue.shift() ?? null)
      : ended
        ? Promise.resolve(null)
        : new Promise(resolve => waiters.push(resolve))
  const reply = async (): Promise<FromLauncher> => {
    const m = await next()
    if (m === null) throw new Error("the lane VM's launcher closed the lease")
    if (m.kind === "refused") throw new VmRefused(launcherWords(m))
    return m
  }

  socket.write(encode({ kind: "lease", agent: input.agent }))
  const slot = await reply().catch(error => {
    socket.destroy()
    throw error
  })
  if (slot.kind !== "slot") throw new Error("the lane VM gave no slot")
  input.log(`[vm] this host has slot ${slot.slot} of the lane VM`)
  await until("Docker answering in the lane VM", 60_000, () =>
    pings(slot.docker),
  )
  let filled = false
  return {
    slot: slot.slot,
    docker: slot.docker,
    async fill(dirs) {
      if (filled) throw new Error("a slot is filled once")
      filled = true
      const shares = planShares(slot.slot, dirs)
      socket.write(encode({ kind: "fill", entries: shares.entries }))
      const m = await reply()
      if (m.kind !== "filled")
        throw new Error("the lane VM did not fill the slot")
      return { pathOf: shares.pathOf }
    },
    async close() {
      socket.end()
      await closed
    },
  }
}
