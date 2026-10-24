import { expect, test } from "vitest"
import {
  FIRST_FRESHNESS,
  type FreshnessState,
  nextTickFreshness,
  sampleEndFreshness,
} from "./freshness.ts"

const ticked = (state: FreshnessState, count: number, bound = 3) => {
  let s = state
  for (let i = 0; i < count; i++) s = nextTickFreshness(s, bound)
  return s
}

test("the reading goes overdue at the bound's tick since the last fresh end, and not before", () => {
  const ended = sampleEndFreshness(ticked(FIRST_FRESHNESS, 2), 1).state
  expect(ticked(ended, 2).overdueAt).toBeNull()
  expect(ticked(ended, 3).overdueAt).toBe(5)
})

test("a sample started before the overdue tick is stale, and one started at it or after is fresh", () => {
  const overdue = ticked(FIRST_FRESHNESS, 3)
  expect(overdue.overdueAt).toBe(3)
  expect(sampleEndFreshness(overdue, 2)).toEqual({
    state: overdue,
    isFresh: false,
  })
  expect(sampleEndFreshness(overdue, 3)).toEqual({
    state: { ticks: 3, lastFreshEnd: 3, overdueAt: null },
    isFresh: true,
  })
})
