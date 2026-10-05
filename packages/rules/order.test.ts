import { expect, test } from "vitest"
import { keyAfter, orderBetween, orderKey, orderKeys } from "./order.ts"

test("keyAfter: the first key with none, else one after the greatest", () => {
  const first = keyAfter([])
  const second = keyAfter([first])
  expect(second > first).toBe(true)
  expect(keyAfter([second, first]) > second).toBe(true)
  expect(keyAfter(["not a key", first])).toBe(second)
})

test.each([
  ["between two neighbours", "k", "between"],
  ["before the first", null, "before"],
  ["after the last", "after", null],
  ["in an empty list", null, null],
] as const)("orderBetween %s", (_, low, high) => {
  const [a, b] = orderKeys(2)
  const before = low === null ? null : (a ?? "")
  const after = high === null ? null : (b ?? "")
  const key = orderBetween(before, after)
  expect(key).not.toBeNull()
  if (key === null) return
  if (before !== null) expect(key > before).toBe(true)
  if (after !== null) expect(key < after).toBe(true)
  expect(key).toHaveLength(orderKey(0).length)
})

test("orderBetween: null when two keys are adjacent, so the caller renumbers", () => {
  expect(orderBetween(orderKey(41), orderKey(42))).toBeNull()
  expect(orderBetween(null, orderKey(0))).toBeNull()
})

test("orderKeys: in order, and each one a key", () => {
  const keys = orderKeys(3)
  expect([...keys].sort()).toEqual(keys)
  expect(new Set(keys).size).toBe(3)
})
