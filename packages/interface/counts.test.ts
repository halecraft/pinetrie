import { expect, test } from "vitest"
import { ago, elapsed, listOf, plural, spanWords, until } from "./counts.ts"

test("plural: one is singular, anything else takes an s", () => {
  expect([0, 1, 2].map(n => plural(n, "card"))).toEqual([
    "0 cards",
    "1 card",
    "2 cards",
  ])
})

test("listOf: names joined as a sentence would", () => {
  expect(listOf(["Ada"])).toBe("Ada")
  expect(listOf(["Ada", "Bea"])).toBe("Ada and Bea")
  expect(listOf(["Ada", "Bea", "Cat"])).toBe("Ada, Bea, and Cat")
})

const NOW = 1_000_000_000
test.each([
  [0, "just now"],
  [59, "just now"],
  [60, "1 min ago"],
  [3000, "50 min ago"],
  [3600, "1 h ago"],
  [7200, "2 h ago"],
  [86_400, "1 d ago"],
  [-5, "just now"],
])("ago: %d s before is %s", (seconds, words) => {
  expect(ago(NOW - seconds * 1000, NOW)).toBe(words)
})

test.each([
  [0, "0s"],
  [999, "0s"],
  [59_999, "59s"],
  [65_000, "1m 05s"],
  [3_599_000, "59m 59s"],
  [3_720_000, "1h 02m"],
  [-5_000, "0s"],
])("elapsed(%d) is %s", (ms, words) => {
  expect(elapsed(ms)).toBe(words)
})

test.each([
  [0, "soon"],
  [59_000, "soon"],
  [5 * 60_000, "in 5 min"],
  [3 * 3_600_000, "in 3 h"],
  [2 * 86_400_000, "in 2 d"],
])("until(%d) is %s", (ms, words) => {
  expect(until(ms)).toBe(words)
})

test.each([
  [7 * 86_400_000, "a week"],
  [14 * 86_400_000, "2 weeks"],
  [10 * 86_400_000, "10 days"],
  [86_400_000, "a day"],
  [36 * 3_600_000, "36 hours"],
  [3_600_000, "an hour"],
  [30 * 60_000, "30 minutes"],
  [90_500, "2 minutes"],
])(
  "spanWords(%d) is %s, in the largest unit it is a whole number of",
  (ms, words) => {
    expect(spanWords(ms)).toBe(words)
  },
)
