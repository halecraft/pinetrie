import { threadIdFor } from "@pinetrie/core"
import fc from "fast-check"
import { expect, test } from "vitest"
import { type LaneImportance, rankLanes } from "./importance.ts"

const lane = (id: string, more: Partial<LaneImportance> = {}) => ({
  lane: threadIdFor(id),
  isRead: false,
  startOrder: null,
  isQueueHeld: false,
  ...more,
})

test("a read lane first, then the latest started, then one whose queue is not held, then by id", () => {
  const ranked = rankLanes([
    lane("t-held", { startOrder: 5, isQueueHeld: true }),
    lane("t-free", { startOrder: 5 }),
    lane("t-old", { startOrder: 1 }),
    lane("t-b"),
    lane("t-a"),
    lane("t-read", { isRead: true }),
    lane("t-new", { startOrder: 9 }),
  ])
  expect(ranked).toEqual(
    ["t-read", "t-new", "t-free", "t-held", "t-old", "t-a", "t-b"].map(
      threadIdFor,
    ),
  )
})

test("the order is total: any order of the same lanes ranks alike", () => {
  const LANE = fc.record({
    lane: fc.constantFrom("t-1", "t-2", "t-3", "t-4").map(threadIdFor),
    isRead: fc.boolean(),
    startOrder: fc.option(fc.integer({ min: 0, max: 3 })),
    isQueueHeld: fc.boolean(),
  })
  const LANES = fc.uniqueArray(LANE, { selector: l => l.lane })
  fc.assert(
    fc.property(
      LANES.chain(lanes =>
        fc.tuple(
          fc.constant(lanes),
          fc.shuffledSubarray(lanes, { minLength: lanes.length }),
        ),
      ),
      ([lanes, shuffled]) => {
        expect(rankLanes(shuffled)).toEqual(rankLanes(lanes))
      },
    ),
  )
})
