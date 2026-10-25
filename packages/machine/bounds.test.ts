import { expect, test } from "vitest"
import { memoryBounds, PRESSURE_BOUNDS } from "./bounds.ts"
import { RUNG_BOUNDS } from "./rung.ts"

test("memory's bounds are the rungs' available shares of the total, and pressure's their full stalls", () => {
  const total = 1000
  expect(memoryBounds(total).map(b => [b.acts, b.clears, b.does])).toEqual([
    [
      RUNG_BOUNDS[2].enter.availableShareBelow * total,
      RUNG_BOUNDS[2].clear.availableShareAbove * total,
      "hold-starts",
    ],
    [
      RUNG_BOUNDS[3].enter.availableShareBelow * total,
      RUNG_BOUNDS[3].clear.availableShareAbove * total,
      "pause-threads",
    ],
  ])
  expect(PRESSURE_BOUNDS.map(b => [b.worse, b.acts, b.clears])).toEqual([
    ["above", RUNG_BOUNDS[2].enter.fullAvg10, RUNG_BOUNDS[2].clear.fullAvg10],
    ["above", RUNG_BOUNDS[3].enter.fullAvg10, RUNG_BOUNDS[3].clear.fullAvg10],
  ])
})
