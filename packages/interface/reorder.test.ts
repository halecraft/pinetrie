import { describe, expect, test } from "vitest"
import {
  EDGE_SPEED,
  EDGE_ZONE,
  edgeScroll,
  keyMove,
  landing,
  pointerGap,
} from "./reorder.ts"

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

describe("edgeScroll", () => {
  const [left, right] = [100, 900]

  test("is zero away from both edges", () => {
    expect(edgeScroll(500, left, right)).toBe(0)
    expect(edgeScroll(left + EDGE_ZONE, left, right)).toBe(0)
    expect(edgeScroll(right - EDGE_ZONE, left, right)).toBe(0)
  })

  test("scrolls left near the left edge and right near the right, fastest at the edge", () => {
    expect(edgeScroll(left, left, right)).toBe(-EDGE_SPEED)
    expect(edgeScroll(right, left, right)).toBe(EDGE_SPEED)
    expect(edgeScroll(left - 30, left, right)).toBe(-EDGE_SPEED)
  })

  test("grows faster nearer the edge", () => {
    const far = edgeScroll(right - EDGE_ZONE + 10, left, right)
    const near = edgeScroll(right - 5, left, right)
    expect(far).toBeGreaterThan(0)
    expect(near).toBeGreaterThan(far)
  })
})
