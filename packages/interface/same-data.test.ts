import { expect, test } from "vitest"
import { sameData } from "./same-data.ts"

test("sameData: a map by its entries, its values by content", () => {
  const map = (entries: [string, { readonly n: number }][]) => new Map(entries)
  expect(sameData(map([["a", { n: 1 }]]), map([["a", { n: 1 }]]))).toBe(true)
  expect(sameData(map([["a", { n: 1 }]]), map([["a", { n: 2 }]]))).toBe(false)
  expect(sameData(map([["a", { n: 1 }]]), map([["b", { n: 1 }]]))).toBe(false)
  expect(
    sameData(
      map([["a", { n: 1 }]]),
      map([
        ["a", { n: 1 }],
        ["b", { n: 1 }],
      ]),
    ),
  ).toBe(false)
  expect(sameData(map([]), {})).toBe(false)
})
