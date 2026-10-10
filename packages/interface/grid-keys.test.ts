import { INVENTORY_GRID } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { type GridKeyState, gridKeyAct } from "./grid-keys.ts"
import type { KeyLike } from "./page-keys.ts"

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
  comments: false,
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

  test("a column's messages are a grid one cell wide (ADR-0126): j and k step through them, stopping at either end; Enter opens the margin, c comments, Escape shuts it", () => {
    const column = (selected: number, over: Partial<GridKeyState> = {}) =>
      at({
        grid: { width: 1, rows: 4 },
        rows: 4,
        selected,
        comments: true,
        ...over,
      })
    expect(gridKeyAct(key("j"), column(1))).toEqual({ kind: "select", cell: 2 })
    expect(gridKeyAct(key("k"), column(1))).toEqual({ kind: "select", cell: 0 })
    expect(gridKeyAct(key("j"), column(3))).toEqual({ kind: "select", cell: 3 })
    expect(gridKeyAct(key("k"), column(0))).toEqual({ kind: "select", cell: 0 })
    expect(gridKeyAct(key("l"), column(1))).toEqual({ kind: "select", cell: 1 })
    expect(gridKeyAct(key("Enter"), column(1))).toEqual({ kind: "open" })
    expect(gridKeyAct(key("c"), column(1))).toEqual({ kind: "comment" })
    expect(gridKeyAct(key("Escape"), column(1, { open: true }))).toEqual({
      kind: "fold",
    })
    // An inventory's cells take no comment.
    expect(gridKeyAct(key("c"), at())).toBeNull()
  })
})
