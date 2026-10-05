import { laneNameForThread, rootIdFor } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readThreadName } from "@pinetrie/reads"
import { expect, test } from "vitest"
import type { HostKey } from "./basics.ts"
import { basics, deferred } from "./fakes.ts"
import { createSettle } from "./settle.ts"

/** A settle over lanes `a` and `b`, recording what it does. */
function setUp() {
  const [a, b] = [laneNameForThread("a"), laneNameForThread("b")]
  const roots = new Map([
    [a, rootIdFor("ra")],
    [b, rootIdFor("rb")],
  ])
  const keeper = createKeeper<HostKey>()
  const done: string[] = []
  const compacting = deferred<void>()
  let hold = false
  const settle = createSettle({
    basics: basics(),
    keeper,
    drain: async lane => {
      done.push(`drain ${lane === a ? "a" : "b"}`)
    },
    rootOf: lane => roots.get(lane) ?? null,
    compact: async covered => {
      done.push(`compact ${[...covered].sort().join(" ")}`)
      if (hold) await compacting.promise
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  return {
    a,
    b,
    keeper,
    done,
    settle,
    holdCompaction: () => {
      hold = true
      return () => compacting.resolve()
    },
  }
}

test("two settles in a burst drain both lanes, then compact once, over both lanes' roots", async () => {
  const { a, b, keeper, done, settle } = setUp()
  // Hold the keeper, so both are asked for before either starts.
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  const first = settle([a])
  const second = settle([b])
  expect(second).toBe(first)
  gate.resolve()
  await first
  expect(done).toEqual(["drain a", "drain b", "compact r-ra r-rb", "sweep"])
})

test("a settle during the compaction queues a second, over its own roots", async () => {
  const { a, b, keeper, done, settle, holdCompaction } = setUp()
  const release = holdCompaction()
  void settle([a])
  await new Promise(r => setTimeout(r, 0))
  expect(done).toEqual(["drain a", "compact r-ra"])
  void settle([b])
  release()
  await keeper.idle()
  expect(done).toEqual([
    "drain a",
    "compact r-ra",
    "sweep",
    "drain b",
    "compact r-rb",
    "sweep",
  ])
})

test("a failed compaction is logged, and the sweep still runs", async () => {
  const b = basics()
  const done: string[] = []
  const settle = createSettle({
    basics: b,
    keeper: createKeeper<HostKey>(),
    drain: async () => {},
    rootOf: () => null,
    compact: async () => {
      throw new Error("store closed")
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  await settle([])
  expect(done).toEqual(["sweep"])
  expect(b.lines).toEqual(["[host] compaction failed: store closed"])
})

test("a failed drain is logged; the other lanes drain, and the next settle compacts", async () => {
  const [a, b] = [laneNameForThread("a"), laneNameForThread("b")]
  const bs = basics()
  const done: string[] = []
  const settle = createSettle({
    basics: bs,
    keeper: createKeeper<HostKey>(),
    drain: async lane => {
      if (lane === a) throw new Error("append refused")
      done.push(`drain ${lane}`)
    },
    rootOf: () => null,
    compact: async () => {
      done.push("compact")
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  await settle([a, b])
  await settle([])
  expect(done).toEqual([`drain ${b}`, "compact", "sweep", "compact", "sweep"])
  expect(bs.lines).toEqual([
    `[host] ${readThreadName(bs.session, a)}: draining failed: append refused`,
  ])
})
