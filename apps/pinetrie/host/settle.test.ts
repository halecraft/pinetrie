import { type RootId, rootIdFor, threadIdFor } from "@pinetrie/core"
import { readThreadName } from "@pinetrie/reads"
import { expect, test } from "vitest"
import { basics, deferred, stepKeeper } from "./fakes.ts"
import { createSettle } from "./settle.ts"

/**
 * A settle over lanes `a` and `b`, recording what it does, its upkeep the
 * keeper's `later` as the host's is: the roots of every settle before it
 * starts, compacted once.
 */
function setUp() {
  const [a, b] = [threadIdFor("a"), threadIdFor("b")]
  const roots = new Map([
    [a, rootIdFor("ra")],
    [b, rootIdFor("rb")],
  ])
  const bs = basics()
  const keeper = stepKeeper(bs)
  const done: string[] = []
  const compacting = deferred<void>()
  let hold = false
  let pending = new Set<RootId>()
  const settle = createSettle({
    basics: bs,
    keeper,
    drain: async (_step, lane) => {
      done.push(`drain ${lane === a ? "a" : "b"}`)
    },
    rootOf: lane => roots.get(lane) ?? null,
    settled: changed => {
      for (const root of changed) pending.add(root)
      return keeper.later("upkeep", async () => {
        const covered = pending
        pending = new Set()
        done.push(`compact ${[...covered].sort().join(" ")}`)
        if (hold) await compacting.promise
      })
    },
  })
  return {
    a,
    b,
    bs,
    keeper,
    done,
    settle,
    holdCompaction: () => {
      hold = true
      return () => compacting.resolve()
    },
  }
}

test("two settles in a burst drain both lanes, then their upkeep runs once, over both lanes' roots", async () => {
  const { a, b, keeper, done, settle } = setUp()
  // Hold the keeper, so both are asked for before either starts.
  const gate = deferred<void>()
  void keeper.run(() => gate.promise)
  const first = settle([a])
  const second = settle([b])
  expect(second).toBe(first)
  gate.resolve()
  await first
  expect(done).toEqual(["drain a", "drain b", "compact r-ra r-rb"])
})

test("a settle during the upkeep queues a second, over its own roots", async () => {
  const { a, b, keeper, done, settle, holdCompaction } = setUp()
  const release = holdCompaction()
  void settle([a])
  await new Promise(r => setTimeout(r, 0))
  expect(done).toEqual(["drain a", "compact r-ra"])
  void settle([b])
  release()
  await keeper.idle()
  expect(done).toEqual(["drain a", "compact r-ra", "drain b", "compact r-rb"])
})

test("a failed drain is logged; the other lanes drain, and the upkeep runs", async () => {
  const { a, b, bs, done } = setUp()
  const failing = createSettle({
    basics: bs,
    keeper: stepKeeper(bs),
    drain: async (_step, lane) => {
      if (lane === a) throw new Error("append refused")
      done.push(`drain ${lane}`)
    },
    rootOf: () => null,
    settled: async () => {
      done.push("upkeep")
    },
  })
  await failing([a, b])
  // The drains are steps of their own, queued before the upkeep asked.
  expect(done).toEqual(["upkeep"])
  await new Promise(r => setTimeout(r, 0))
  expect(done).toEqual(["upkeep", `drain ${b}`])
  expect(bs.lines).toEqual([
    `[host] ${readThreadName(bs.session, a)}: draining failed: append refused`,
  ])
})
