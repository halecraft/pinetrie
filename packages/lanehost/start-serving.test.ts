import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { type HeldLock, type LockAttempt, tryLock } from "@pinetrie/lock"
import { afterAll, describe, expect, test } from "vitest"
import type { Serving } from "./answer.ts"
import { dropUnfinishedSnapshots } from "./disks.ts"
import { testServerArgs } from "./fixtures.ts"
import { projectDisks } from "./layout.ts"
import { servingFrom } from "./serving.ts"
import {
  lockRefusal,
  type ServingPorts,
  startServing,
} from "./start-serving.ts"

const KEY = "0123456789abcdef"
const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-start-serving-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const serving = (holds: string | null): Serving => ({
  ...servingFrom(testServerArgs("disks", dir)),
  holds,
})

const HELD: HeldLock = {
  kind: "held",
  file: "host.lock",
  release: async () => {},
  lockLost: new Promise(() => {}),
}

/** Ports that record what the start did, in order, holding with `hold`. */
function recorded(hold: LockAttempt) {
  const did: string[] = []
  let refused: string | null | undefined
  let answer: Parameters<ServingPorts["serve"]>[1] | undefined
  const ports: ServingPorts = {
    hold: async file => {
      did.push(`hold ${path.basename(file)}`)
      return hold
    },
    drop: async () => {
      did.push("drop")
    },
    serve: (r, a) => {
      did.push("serve")
      refused = r
      answer = a
    },
    lost: () => did.push("lost"),
  }
  return {
    ports,
    did,
    refusedWith: () => refused,
    call: () => answer?.({ kind: "projects" }),
  }
}

describe("startServing", () => {
  test("a server that holds no lock serves at once", async () => {
    const r = recorded(HELD)
    await startServing(serving(null), r.ports)
    expect(r.did).toEqual(["serve"])
    expect(r.refusedWith()).toBe(null)
  })

  test("the lock is held before the drop, and the drop runs before any call is answered", async () => {
    const r = recorded(HELD)
    await startServing(serving(KEY), r.ports)
    expect(r.did).toEqual(["hold host.lock", "drop", "serve"])
  })

  test("a lock another holds refuses every call, its hello saying why, and drops nothing", async () => {
    const r = recorded({ kind: "held-by-another" })
    await startServing(serving(KEY), r.ports)
    expect(r.did).toEqual(["hold host.lock", "serve"])
    const words = lockRefusal({ kind: "held-by-another" })
    expect(r.refusedWith()).toBe(words)
    await expect(r.call()).rejects.toThrow(words)
  })

  test("a lock lost stops the server", async () => {
    const r = recorded({ ...HELD, lockLost: Promise.resolve() })
    await startServing(serving(KEY), r.ports)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(r.did).toContain("lost")
  })
})

test("two servers on one project: the second refuses, and drops nothing of the first's", {
  tags: ["flock"],
}, async () => {
  const disks = projectDisks(dir, KEY)
  await mkdir(disks.snapshots, { recursive: true })
  const holds: LockAttempt[] = []
  const started = () => {
    const r = recorded(HELD)
    const until = new PassThrough()
    r.ports.hold = async file => {
      const hold = await tryLock(file, {
        platform: "linux",
        heldWhile: until,
      })
      holds.push(hold)
      return hold
    }
    r.ports.drop = dropUnfinishedSnapshots
    return r
  }
  try {
    const first = started()
    await startServing(serving(KEY), first.ports)
    expect(first.refusedWith()).toBe(null)
    await writeFile(path.join(disks.snapshots, "x.tmp"), "in the making")
    const second = started()
    await startServing(serving(KEY), second.ports)
    expect(second.refusedWith()).toBe(lockRefusal({ kind: "held-by-another" }))
    expect(await readdir(disks.snapshots)).toEqual(["x.tmp"])
  } finally {
    for (const h of holds) if (h.kind === "held") await h.release()
  }
})
