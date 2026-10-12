import { describe, expect, test } from "vitest"
import {
  keyAfter,
  orderBetween,
  orderKey,
  orderKeys,
  respace,
} from "./order.ts"

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

/** A key for `n`, as the module writes them: ten base-36 digits. */
const key = (n: number): string => n.toString(36).padStart(10, "0")
const num = (k: string): number => Number.parseInt(k, 36)

describe("orderBetween", () => {
  test("a step from the one neighbour given, or the middle of the range for none", () => {
    const mid = orderBetween(null, null)
    expect(mid).not.toBeNull()
    const a = key(1000)
    const after = orderBetween(a, null)
    const before = orderBetween(null, a)
    expect(after !== null && after > a).toBe(true)
    expect(before !== null && before < a).toBe(true)
    expect(after?.length).toBe(10)
  })

  test("the midpoint between two neighbours", () => {
    expect(orderBetween(key(10), key(20))).toBe(key(15))
  })

  test("null when no key fits: adjacent keys, keys out of order, or no key", () => {
    expect(orderBetween(key(10), key(11))).toBeNull()
    expect(orderBetween(key(20), key(10))).toBeNull()
    expect(orderBetween(key(10), key(10))).toBeNull()
    expect(orderBetween("not a key!", key(10))).toBeNull()
  })

  test("before the first possible key there is no room", () => {
    expect(orderBetween(null, key(0))).toBeNull()
  })
})

describe("respace", () => {
  /** `orders` with the new key put at `index` and every changed key written. */
  const applied = (orders: readonly string[], index: number): string[] => {
    const { changed, inserted } = respace(orders, index)
    const now = orders.map((o, i) => changed.get(i) ?? o)
    return [...now.slice(0, index), inserted, ...now.slice(index)]
  }
  const ascending = (keys: readonly string[]) =>
    keys.every((k, i) => i === 0 || (keys[i - 1] ?? "") < k)

  test("in a crowded run, only the crowded keys change, and every key keeps its order", () => {
    const orders = [key(0), key(1000), key(1001), key(1002), key(5000)]
    const { changed } = respace(orders, 2)
    expect(changed.has(0)).toBe(false)
    expect(changed.has(4)).toBe(false)
    const after = applied(orders, 2)
    expect(ascending(after)).toBe(true)
    for (let i = 1; i < after.length; i++)
      expect(
        num(after[i] ?? "") - num(after[i - 1] ?? ""),
      ).toBeGreaterThanOrEqual(2)
  })

  test("at the front and at the back", () => {
    const front = [key(0), key(1), key(2)]
    expect(ascending(applied(front, 0))).toBe(true)
    const back = [key(10), key(11)]
    const atBack = applied(back, 2)
    expect(ascending(atBack)).toBe(true)
  })

  test("a window with room changes nothing around it", () => {
    const orders = [key(0), key(100), key(200)]
    const { changed, inserted } = respace(orders, 1)
    expect(changed.size).toBe(0)
    expect(num(inserted)).toBe(50)
  })
})
