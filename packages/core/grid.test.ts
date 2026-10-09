import { describe, expect, test } from "vitest"
import { firstEmpty, INVENTORY_GRID, INVENTORY_SLOTS, step } from "./grid.ts"

describe("the grid (ADR-0048)", () => {
  test("an inventory holds 18 cards", () => {
    expect(INVENTORY_SLOTS).toBe(18)
  })

  test("firstEmpty: the start when empty, else the first in reading order; null when a fixed grid is full", () => {
    const some = new Set([0, 2, 3])
    expect(firstEmpty(INVENTORY_GRID, some, 5)).toBe(5)
    expect(firstEmpty(INVENTORY_GRID, some, 2)).toBe(1)
    expect(firstEmpty(INVENTORY_GRID, some)).toBe(1)
    expect(firstEmpty(INVENTORY_GRID, some, 99)).toBe(1)
    const full = new Set(Array.from({ length: 18 }, (_, n) => n))
    expect(firstEmpty(INVENTORY_GRID, full, 3)).toBeNull()
  })

  test.each([
    ["left at the left edge", 6, "left", 6],
    ["left", 7, "left", 6],
    ["right at the right edge", 5, "right", 5],
    ["right", 4, "right", 5],
    ["up at the top", 2, "up", 2],
    ["up", 8, "up", 2],
    ["down at the foot", 14, "down", 14],
    ["down", 2, "down", 8],
  ] as const)("step on the 3 × 6 inventory: %s", (_, from, dir, to) => {
    expect(step(INVENTORY_GRID, 3, from, dir)).toBe(to)
  })
})
