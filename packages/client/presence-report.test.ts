import { describe, expect, test } from "vitest"
import { planReading, TYPING_EVERY_MS, typingDue } from "./presence-report.ts"

const map = (entries: Record<string, string | null>) =>
  new Map(Object.entries(entries))

describe("planReading", () => {
  test("a column whose end is new is set; one whose end is the same is not", () => {
    expect(
      planReading(map({ a: "1", b: "2" }), map({ a: "1", b: "3" })),
    ).toEqual({ set: [["b", "3"]], clear: [] })
  })

  test("switching tabs clears every column of the last tab", () => {
    expect(planReading(map({ a: "1", b: "2" }), map({ c: "3" }))).toEqual({
      set: [["c", "3"]],
      clear: ["a", "b"],
    })
  })

  test("a column with no thread end yet is neither set nor cleared", () => {
    expect(planReading(map({}), map({ n: null }))).toEqual({
      set: [],
      clear: [],
    })
    expect(planReading(map({ a: "1" }), map({ a: null }))).toEqual({
      set: [],
      clear: [],
    })
  })
})

test("typing is written at most once a second", () => {
  expect(typingDue(0, TYPING_EVERY_MS - 1)).toBe(false)
  expect(typingDue(0, TYPING_EVERY_MS)).toBe(true)
})
