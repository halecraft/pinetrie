import { threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { cardBeforeGap, keyMove, landing, pointerGap } from "./reorder.ts"

// Three columns 100 wide, from 0: centres 50, 150, 250.
const mids = [50, 150, 250]

describe("pointerGap", () => {
  test("is the number of columns whose centre is left of the pointer", () => {
    expect(pointerGap(mids, 10)).toBe(0)
    expect(pointerGap(mids, 120)).toBe(1)
    expect(pointerGap(mids, 200)).toBe(2)
    expect(pointerGap(mids, 400)).toBe(3)
  })

  test("a pointer on a centre is before that column", () => {
    expect(pointerGap(mids, 150)).toBe(1)
  })
})

describe("landing", () => {
  test("the gaps either side of a column leave it where it is", () => {
    expect(landing(1, 1)).toBeNull()
    expect(landing(1, 2)).toBeNull()
  })

  test("a gap to the left is the index it lands at", () => {
    expect(landing(2, 0)).toBe(0)
    expect(landing(2, 1)).toBe(1)
  })

  test("a gap to the right lands one short of it, since the column leaves its own place", () => {
    expect(landing(0, 2)).toBe(1)
    expect(landing(0, 3)).toBe(2)
  })
})

describe("keyMove", () => {
  test("arrows move one place; Home and End move nothing", () => {
    expect(keyMove(1, 4, "ArrowLeft")).toBe(0)
    expect(keyMove(1, 4, "ArrowRight")).toBe(2)
    expect(keyMove(2, 4, "Home")).toBeNull()
    expect(keyMove(1, 4, "End")).toBeNull()
  })

  test("no move past either end, to where it is, or for another key", () => {
    expect(keyMove(0, 4, "ArrowLeft")).toBeNull()
    expect(keyMove(3, 4, "ArrowRight")).toBeNull()
    expect(keyMove(1, 4, "Enter")).toBeNull()
  })
})

test("a drop on the strip lands after the column before the gap it is in; before them all, after none", () => {
  const [a, b] = [threadIdFor("a"), threadIdFor("b")]
  const columns = [
    { card: a, mid: 100 },
    { card: b, mid: 300 },
  ]
  expect(cardBeforeGap(columns, 50)).toBeNull()
  expect(cardBeforeGap(columns, 150)).toBe(a)
  expect(cardBeforeGap(columns, 299)).toBe(a)
  expect(cardBeforeGap(columns, 900)).toBe(b)
})
