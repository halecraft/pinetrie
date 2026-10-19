import { INVENTORY_GRID } from "@pinetrie/threads"
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
  rows: 6,
  selected: 5,
  hasCard: true,
  open: false,
  inText: false,
  comments: false,
  trashes: true,
  ...over,
})

describe("gridKeyAct", () => {
  test.each([
    ["ArrowLeft", 4],
    ["h", 4],
    ["ArrowRight", 5],
    ["l", 5],
    ["ArrowUp", 3],
    ["k", 3],
    ["ArrowDown", 7],
    ["j", 7],
  ])("%s selects the next cell", (k, cell) => {
    expect(gridKeyAct(key(k), at())).toEqual({ kind: "select", cell })
  })

  test("Alt+arrows move the selected card a cell; not with none, nor past an edge", () => {
    expect(gridKeyAct(key("ArrowLeft", { altKey: true }), at())).toEqual({
      kind: "move",
      from: 5,
      to: 4,
    })
    expect(
      gridKeyAct(key("ArrowLeft", { altKey: true }), at({ hasCard: false })),
    ).toBeNull()
    expect(
      gridKeyAct(key("ArrowUp", { altKey: true }), at({ selected: 1 })),
    ).toBeNull()
  })

  test("Delete or Backspace trashes the selected card; not on an empty cell, nor in a column", () => {
    expect(gridKeyAct(key("Delete"), at())).toEqual({ kind: "trash" })
    expect(gridKeyAct(key("Backspace"), at())).toEqual({ kind: "trash" })
    expect(gridKeyAct(key("Delete"), at({ hasCard: false }))).toBeNull()
    expect(gridKeyAct(key("Delete"), at({ trashes: false }))).toBeNull()
    expect(gridKeyAct(key("Delete"), at({ inText: true }))).toBeNull()
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
    expect(gridKeyAct(key("j"), at({ selected: 11 }))).toEqual({
      kind: "select",
      cell: 11,
    })
  })

  test("a column's messages are a grid one cell wide: j and k step, Enter opens the margin, c comments", () => {
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
