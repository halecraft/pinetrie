import { INVENTORY_GRID } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { type GridKeyState, gridKeyAct } from "./grid-keys.ts"
import type { KeyLike } from "./inventory-keys.ts"

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})
const at = (over: Partial<GridKeyState> = {}): GridKeyState => ({
  grid: INVENTORY_GRID,
  rows: 3,
  selected: 7,
  hasCard: true,
  open: false,
  inText: false,
  ...over,
})

describe("gridKeyAct (ADR-0113)", () => {
  test.each([
    ["ArrowLeft", 6],
    ["h", 6],
    ["ArrowRight", 8],
    ["l", 8],
    ["ArrowUp", 1],
    ["k", 1],
    ["ArrowDown", 13],
    ["j", 13],
  ])("%s selects the next cell", (k, cell) => {
    expect(gridKeyAct(key(k), at())).toEqual({ kind: "select", cell })
  })

  test("Alt+arrows move the selected card a cell; not with none, nor past an edge", () => {
    expect(gridKeyAct(key("ArrowRight", { altKey: true }), at())).toEqual({
      kind: "move",
      from: 7,
      to: 8,
    })
    expect(
      gridKeyAct(key("ArrowRight", { altKey: true }), at({ hasCard: false })),
    ).toBeNull()
    expect(
      gridKeyAct(key("ArrowUp", { altKey: true }), at({ selected: 1 })),
    ).toBeNull()
  })

  test("Enter on an empty cell does nothing", () => {
    expect(gridKeyAct(key("Enter"), at({ hasCard: false }))).toBeNull()
  })

  test("Enter opens a card; Escape folds an open one", () => {
    expect(gridKeyAct(key("Enter"), at())).toEqual({ kind: "open" })
    expect(gridKeyAct(key("Enter"), at({ hasCard: false }))).toBeNull()
    expect(gridKeyAct(key("Escape"), at({ open: true }))).toEqual({
      kind: "fold",
    })
    expect(gridKeyAct(key("Escape"), at())).toBeNull()
  })

  test("in the open card's box only Escape is the grid's", () => {
    const inText = at({ open: true, inText: true })
    expect(gridKeyAct(key("ArrowLeft"), inText)).toBeNull()
    expect(gridKeyAct(key("Enter"), inText)).toBeNull()
    expect(gridKeyAct(key("Escape"), inText)).toEqual({ kind: "fold" })
  })

  test("a move stops at the last row", () => {
    expect(gridKeyAct(key("j"), at({ selected: 13 }))).toEqual({
      kind: "select",
      cell: 13,
    })
  })
})
