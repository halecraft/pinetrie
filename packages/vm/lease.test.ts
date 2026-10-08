// The lease's client against a stand-in launcher speaking the protocol: the
// real launcher is checked on the Mac (`packages/vm/launcher/prove.sh`).

import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { afterEach, expect, test } from "vitest"
import { connect, leaseOn } from "./lease.ts"
import {
  decodeToLauncher,
  encode,
  type FromLauncher,
  type ToLauncher,
} from "./protocol.ts"

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
        s.write(encode(reply.kind === "slot" ? { ...reply, docker } : reply))
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
    control,
    seen,
    ended: () => ended,
    drop: () => {
      for (const s of sockets) s.end()
    },
  }
}

const log = () => {}

test("a lease: a slot, then one fill with the slot's entries, then the end frees it", async () => {
  const l = await standIn(m =>
    m.kind === "lease" ? slotReply(2) : { kind: "filled" },
  )
  const socket = await connect(l.control)
  if (socket === null) throw new Error("no stand-in")
  const lease = await leaseOn(socket, { agent: "/a.sock", log })
  expect(lease.slot).toBe(2)
  const { pathOf } = await lease.fill([
    { source: "/p", readOnly: true },
    { source: "/p/.plans", readOnly: false },
  ])
  expect(pathOf("/p")).toMatch(/^\/mnt\/host-shares\/2\/[0-9a-f]{16}$/)
  await expect(lease.fill([])).rejects.toThrow("a slot is filled once")
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
