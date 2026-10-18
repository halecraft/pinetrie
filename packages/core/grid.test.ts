import { describe, expect, test } from "vitest"
import {
  firstEmpty,
  INVENTORY_GRID,
  INVENTORY_SLOTS,
  inventoryGrid,
  step,
} from "./grid.ts"

describe("the grid", () => {
  test("an inventory holds 12 cards", () => {
    expect(INVENTORY_SLOTS).toBe(12)
  })

  test("inventoryGrid grows a row for every two cards past 12", () => {
    expect(inventoryGrid(0)).toEqual(INVENTORY_GRID)
    expect(inventoryGrid(12)).toEqual(INVENTORY_GRID)
    expect(inventoryGrid(13)).toEqual({ width: 2, rows: 7 })
    expect(inventoryGrid(16)).toEqual({ width: 2, rows: 8 })
  })

  test("firstEmpty: the start when empty, else the first in reading order; null when a fixed grid is full", () => {
    const some = new Set([0, 2, 3])
    expect(firstEmpty(INVENTORY_GRID, some, 5)).toBe(5)
    expect(firstEmpty(INVENTORY_GRID, some, 2)).toBe(1)
    expect(firstEmpty(INVENTORY_GRID, some)).toBe(1)
    expect(firstEmpty(INVENTORY_GRID, some, 99)).toBe(1)
    const full = new Set(Array.from({ length: 12 }, (_, n) => n))
    expect(firstEmpty(INVENTORY_GRID, full, 3)).toBeNull()
  })

  test.each([
    ["left at the left edge", 4, "left", 4],
    ["left", 5, "left", 4],
    ["right at the right edge", 3, "right", 3],
    ["right", 2, "right", 3],
    ["up at the top", 1, "up", 1],
    ["up", 5, "up", 3],
    ["down at the foot", 10, "down", 10],
    ["down", 1, "down", 3],
  ] as const)("step on the 2 × 6 inventory: %s", (_, from, dir, to) => {
    expect(step(INVENTORY_GRID, 6, from, dir)).toBe(to)
  })
})
