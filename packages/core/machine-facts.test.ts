import { expect, test } from "vitest"
import { type ActingBound, boundReading } from "./machine-facts.ts"

const low: ActingBound = {
  worse: "below",
  acts: 10,
  clears: 15,
  does: "delete-snapshots",
}
const high: ActingBound = {
  worse: "above",
  acts: 5,
  clears: 1,
  does: "hold-starts",
}

test("a reading is over past acts, near until past clears, and clear beyond, on its worse side", () => {
  expect([9, 10, 14, 15, 16].map(v => boundReading(v, low))).toEqual([
    "over",
    "near",
    "near",
    "clear",
    "clear",
  ])
  expect([6, 5, 2, 1, 0].map(v => boundReading(v, high))).toEqual([
    "over",
    "near",
    "near",
    "clear",
    "clear",
  ])
})
