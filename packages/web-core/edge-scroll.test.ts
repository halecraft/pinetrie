import { describe, expect, test } from "vitest"
import { EDGE_SPEED, EDGE_ZONE, edgeScroll } from "./edge-scroll.ts"

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
