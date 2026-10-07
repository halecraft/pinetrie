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

/** A launcher that answers each message with `answer`'s reply, and a Docker that pings. */
async function standIn(
  answer: (m: ToLauncher, seen: ToLauncher[]) => FromLauncher | null,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-lease-"))
  const docker = path.join(dir, "docker.sock")
  const control = path.join(dir, "control.sock")
  const pinger = http.createServer((_req, res) => res.end("OK"))
  await new Promise<void>(r => pinger.listen(docker, r))
  const seen: ToLauncher[] = []
  let ended = false
  const launcher = net.createServer(s => {
    createInterface({ input: s }).on("line", line => {
      const m = decodeToLauncher(line)
      if (m === null) return
      seen.push(m)
      const reply = answer(m, seen)
      if (reply !== null)
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
  return { control, seen, ended: () => ended }
}

const log = () => {}

test("a lease: a slot, then one fill with the slot's entries, then the end frees it", async () => {
  const l = await standIn(m =>
    m.kind === "lease"
      ? { kind: "slot", slot: 2, docker: "" }
      : { kind: "filled" },
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
