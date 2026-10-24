// The lease's client against a stand-in launcher speaking the protocol: the
// real launcher is checked on the Mac by the lanes suite's `contract` scenario.

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { tryLock } from "@pinetrie/lock"
import { childHoldingLock } from "@pinetrie/lock/testing"
import { afterEach, expect, test } from "vitest"
import {
  connect,
  DiskFullAtBoot,
  gatherRunningVm,
  leaseExtra,
  leaseOn,
  leaseStartedVm,
  readVmLogTail,
  startLaneVm,
} from "./lease.ts"
import {
  decodeToLauncher,
  encode,
  type FromLauncher,
  type ToLauncher,
} from "./protocol.ts"
import {
  awaitLauncherGone,
  LAUNCHER_LOCK,
  REPAIR_LOCK,
  takeRepairLock,
} from "./repair-lock.ts"

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of closers.splice(0)) await c()
})

/** A slot's reply, the VM's identity included. */
const slotReply = (slot: number, leases = 1): FromLauncher => ({
  kind: "slot",
  slot,
  docker: "",
  image: "img",
  launcher: "launcher-x",
  leases,
})

/**
 * A launcher that answers each message with `answer`'s reply, or ends the
 * connection (`"end"`), and a Docker that pings. `drop` ends every lease, as
 * a launcher that stops does.
 */
async function standIn(
  answer: (m: ToLauncher, seen: ToLauncher[]) => FromLauncher | "end" | null,
  options: { readonly isDockerSilent?: boolean } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-lease-"))
  const docker = path.join(dir, "docker.sock")
  const control = path.join(dir, "control.sock")
  const pinger = http.createServer((_req, res) => res.end("OK"))
  await new Promise<void>(r => pinger.listen(docker, r))
  const seen: ToLauncher[] = []
  let ended = false
  const sockets: net.Socket[] = []
  const launcher = net.createServer(s => {
    sockets.push(s)
    createInterface({ input: s }).on("line", line => {
      const m = decodeToLauncher(line)
      if (m === null) return
      seen.push(m)
      const reply = answer(m, seen)
      if (reply === "end") s.end()
      else if (reply !== null)
        s.write(
          encode(
            reply.kind === "slot"
              ? {
                  ...reply,
                  docker: options.isDockerSilent
                    ? path.join(dir, "nothing.sock")
                    : docker,
                }
              : reply,
          ),
        )
    })
    s.on("close", () => {
      ended = true
    })
  })
  await new Promise<void>(r => launcher.listen(control, r))
  closers.push(async () => {
    launcher.close()
    pinger.close()
    await rm(dir, { recursive: true, force: true })
  })
  return {
    dir,
    control,
    seen,
    ended: () => ended,
    drop: () => {
      for (const s of sockets) s.end()
    },
  }
}

const log = () => {}

test("a lease: a slot, filled once with its entries after its stop settles, then the end frees it", async () => {
  let isStopSettled = false
  const fillSeen: boolean[] = []
  const l = await standIn(m => {
    if (m.kind === "lease") return slotReply(2)
    fillSeen.push(isStopSettled)
    return { kind: "filled" }
  })
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  const lease = await leaseOn(socket, { agent: "/a.sock", log })
  expect(lease.slot).toBe(2)
  const stopped: number[] = []
  // Settles a while after it is called, so a fill sent without waiting for
  // it reaches the launcher first.
  const stop = async (slot: number) => {
    stopped.push(slot)
    await new Promise(r => setTimeout(r, 50))
    isStopSettled = true
  }
  const filled = await lease.fill(
    [
      { source: "/p", readOnly: true },
      { source: "/p/.plans", readOnly: false },
    ],
    stop,
  )
  expect(stopped).toEqual([2])
  expect(fillSeen).toEqual([true])
  expect(filled.slot).toBe(2)
  expect(filled.entries.map(e => e.source).sort()).toEqual(["/p", "/p/.plans"])
  await expect(lease.fill([], stop)).rejects.toThrow("a slot is filled once")
  expect(l.seen[0]).toEqual({ kind: "lease", agent: "/a.sock" })
  expect(l.seen[1]).toMatchObject({ kind: "fill" })
  expect(l.seen.length).toBe(2)
  await lease.close()
  await new Promise(r => setTimeout(r, 50))
  expect(l.ended()).toBe(true)
})

test("a full VM refuses the lease, naming the limit and lanes.vm.slots", async () => {
  const l = await standIn(() => ({
    kind: "refused",
    reason: "full",
    slots: 16,
  }))
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  await expect(leaseOn(socket, { agent: null, log })).rejects.toThrow(
    /all 16 slots .* `lanes\.vm\.slots`/,
  )
})

const leaseFrom = async (l: { control: string }) => {
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  return leaseOn(socket, { agent: null, log })
}
const settled = (p: Promise<unknown>, ms = 200) =>
  Promise.race([
    p.then(() => true),
    new Promise<boolean>(r => setTimeout(() => r(false), ms)),
  ])

test("a lease's end is told when the launcher drops it, and not after the host closed it", async () => {
  const l = await standIn(m => (m.kind === "lease" ? slotReply(0) : null))
  const dropped = await leaseFrom(l)
  expect(dropped.identity).toEqual({
    image: "img",
    launcher: "launcher-x",
    leases: 1,
  })
  l.drop()
  expect(await settled(dropped.ended)).toBe(true)
  const closed = await leaseFrom(l)
  await closed.close()
  expect(await settled(closed.ended)).toBe(false)
})

test("retire: the launcher stops and ends the lease, or refuses while others hold leases", async () => {
  const alone = await standIn(m =>
    m.kind === "lease" ? slotReply(0) : m.kind === "retire" ? "end" : null,
  )
  const lease = await leaseFrom(alone)
  await lease.retire()
  expect(alone.seen.map(m => m.kind)).toEqual(["lease", "retire"])
  expect(await settled(lease.ended)).toBe(false)
  const shared = await standIn(m =>
    m.kind === "lease"
      ? slotReply(0, 3)
      : m.kind === "retire"
        ? { kind: "refused", reason: "busy", leases: 3 }
        : null,
  )
  await expect((await leaseFrom(shared)).retire()).rejects.toThrow(
    "2 other hosts hold leases",
  )
})

test("a launcher that never answers fails the lease in time, naming what it waited for", async () => {
  const l = await standIn(() => null)
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  await expect(
    leaseOn(socket, { agent: null, log, replyMs: 100 }),
  ).rejects.toThrow("did not answer a lease in 0.1 s")
})

test("an extra lease: another slot of the same launcher, stopped and filled with only what it is given", async () => {
  let next = 0
  const l = await standIn(m =>
    m.kind === "lease" ? slotReply(next++) : { kind: "filled" },
  )
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  const host = await leaseOn(socket, { agent: "/a.sock", log })
  const stopped: number[] = []
  const stop = async (slot: number) => {
    stopped.push(slot)
  }
  await host.fill([{ source: "/p", readOnly: true }], stop)
  const extra = await leaseExtra({
    stateDir: path.dirname(l.control),
    dirs: [{ source: "/p/docs", readOnly: false }],
    stop,
    log,
  })
  expect(stopped).toEqual([0, 1])
  expect(extra.fill.slot).toBe(1)
  expect(extra.fill.entries.map(e => [e.source, e.readOnly])).toEqual([
    ["/p/docs", false],
  ])
  expect(l.seen[2]).toEqual({ kind: "lease", agent: null })
  await extra.close()
  await host.close()
})

test("the running VM: none when nothing answers, else its status, asked without a lease", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "pinetrie-lease-"))
  closers.push(() => rm(empty, { recursive: true, force: true }))
  expect(await gatherRunningVm(empty)).toEqual({ kind: "none" })
  const l = await standIn(m =>
    m.kind === "status"
      ? { kind: "status", image: "img", launcher: "launcher-x", leases: 2 }
      : null,
  )
  expect(await gatherRunningVm(path.dirname(l.control))).toEqual({
    kind: "running",
    image: "img",
    launcher: "launcher-x",
    leases: 2,
  })
  expect(l.seen).toEqual([{ kind: "status" }])
})

test("a launcher that refuses status is running, its holders not known", async () => {
  const l = await standIn(() => ({ kind: "refused", reason: "unreadable" }))
  expect(await gatherRunningVm(path.dirname(l.control))).toEqual({
    kind: "running",
    image: null,
    launcher: null,
    leases: null,
  })
})

/** Settles once `onWaiting` is told, the lock found held. */
const waitingTold = () => {
  let told: () => void = () => {}
  const heard = new Promise<void>(r => {
    told = r
  })
  return { onWaiting: () => told(), heard }
}

test("a VM's start waits while another holds the repair lock, growing nothing meanwhile; its holder killed frees it", async () => {
  const l = await standIn(() => null)
  const holder = childHoldingLock(path.join(l.dir, REPAIR_LOCK))
  closers.push(async () => {
    holder.child.kill("SIGKILL")
    await holder.exited
  })
  expect(await holder.said).toBe("held")
  const grown: number[] = []
  const { onWaiting, heard } = waitingTold()
  const starting = startLaneVm(
    {
      stateDir: l.dir,
      slots: 1,
      agent: null,
      log,
      servicesFloorBytes: 0,
      onStartWaiting: onWaiting,
      growData: () => {
        grown.push(1)
        return null
      },
    },
    { binary: "/usr/bin/false", argv: [] },
  )
  await heard
  expect(grown).toEqual([])
  holder.child.kill("SIGKILL")
  // The stand-in answers by now: started by another host while this one
  // waited, it is joined, and nothing grows.
  const started = await starting
  started.socket.destroy()
  expect(started.started).toBeNull()
  expect(grown).toEqual([])
})

test("the launcher's lock is waited for while a launcher holds it, then held: no launcher can take it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-repair-"))
  closers.push(() => rm(dir, { recursive: true, force: true }))
  const launcher = childHoldingLock(path.join(dir, LAUNCHER_LOCK))
  closers.push(async () => {
    launcher.child.kill("SIGKILL")
    await launcher.exited
  })
  expect(await launcher.said).toBe("held")
  const repair = await takeRepairLock(dir)
  if (repair === "held-by-another" || !("lock" in repair))
    throw new Error("the repair lock was not taken")
  const { onWaiting, heard } = waitingTold()
  const gone = awaitLauncherGone(repair, onWaiting)
  await heard
  launcher.child.kill("SIGKILL")
  const held = await gone
  if (!("lock" in held)) throw new Error(held.detail)
  const another = await tryLock(path.join(dir, LAUNCHER_LOCK), {
    platform: process.platform,
    heldWhile: "until-released",
  })
  expect(another.kind).toBe("held-by-another")
  await held.lock.release()
  await repair.lock.release()
})

const FULL_CONSOLE = `T+0.21 stage 1: system image mounted
T+1.02 data disk room: unallocated=1048576 metadata=101711872/107347968
T+1.02 data disk full
`

for (const isDockerSilent of [false, true])
  test(`a start whose console says the data disk is full fails as such, ${isDockerSilent ? "Docker silent" : "though Docker answered"}`, async () => {
    const l = await standIn(m => (m.kind === "lease" ? slotReply(0) : null), {
      isDockerSilent,
    })
    await writeFile(path.join(l.dir, "console.log"), FULL_CONSOLE)
    const socket = await connect(l.control)
    if (socket === null) throw new Error("no stand-in")
    await expect(
      leaseStartedVm(
        socket,
        { stateDir: l.dir, agent: null, log, dockerMs: 300 },
        0,
      ),
    ).rejects.toBeInstanceOf(DiskFullAtBoot)
  })

test("a log's tail is its last lines, a cut first line dropped; a log not there is none", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vm-log-"))
  try {
    await writeFile(path.join(dir, "console.log"), "one\ntwo\nthree\n")
    const long = `${"x".repeat(70 * 1024)}\nlast\n`
    await writeFile(path.join(dir, "launcher.log"), long)
    expect([
      await readVmLogTail(dir, "console.log", 2),
      await readVmLogTail(dir, "launcher.log", 5),
      await readVmLogTail(path.join(dir, "gone"), "console.log", 2),
    ]).toEqual([["two", "three"], ["last"], null])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
