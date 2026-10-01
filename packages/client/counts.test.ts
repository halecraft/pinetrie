import { expect, test } from "vitest"
import { listOf, plural } from "./counts.ts"

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
