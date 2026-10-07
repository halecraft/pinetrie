import { cardIdOfKind } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { type KeyFocus, type KeyLike, keyAct } from "./page-keys.ts"

const C1 = cardIdFor("c1")
const C2 = cardIdFor("c2")
const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})
const focus = (over: Partial<KeyFocus> = {}): KeyFocus => ({
  card: null,
  inText: false,
  inPanel: false,
  selectedCard: C2,
  column: "k-1",
  page: false,
  search: "closed",
  ...over,
})
const chord = { ctrlKey: true, shiftKey: true }

describe("keyAct", () => {
  test("Cmd+X outside a text box takes the focused card; in a box it is the box's own cut (ADR-0126)", () => {
    const take = { kind: "takeIntoInventory", card: C1 }
    expect(keyAct(key("x", { metaKey: true }), focus({ card: C1 }))).toEqual(
      take,
    )
    expect(keyAct(key("x", { ctrlKey: true }), focus({ card: C1 }))).toEqual(
      take,
    )
    expect(
      keyAct(key("x", { metaKey: true }), focus({ card: C1, inText: true })),
    ).toBeNull()
    expect(keyAct(key("x", { metaKey: true }), focus())).toBeNull()
  })

  test("the put key in a text box puts a reference there; any other card goes to the column (ADR-0126)", () => {
    const REF = cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e1",
    )
    expect(
      keyAct(key("O", chord), focus({ selectedCard: REF, inText: true })),
    ).toEqual({ kind: "put", card: REF, target: { kind: "text-box" } })
    expect(keyAct(key("O", chord), focus({ inText: true }))).toEqual({
      kind: "put",
      card: C2,
      target: { kind: "column", key: "k-1" },
    })
  })

  test("Ctrl+Shift+L folds or unfolds the sidebar, in a text box too, and not with Meta or Alt", () => {
    const fold = { kind: "foldList" }
    expect(keyAct(key("L", chord), focus())).toEqual(fold)
    expect(keyAct(key("L", chord), focus({ inText: true }))).toEqual(fold)
    expect(keyAct(key("L", { ...chord, metaKey: true }), focus())).toBeNull()
    expect(keyAct(key("L", { ...chord, altKey: true }), focus())).toBeNull()
    expect(keyAct(key("l", { ctrlKey: true }), focus())).toBeNull()
  })

  test("Ctrl+Shift+I takes the focused card, in a text box too; Ctrl+Shift+O puts the selected one in the last focused column", () => {
    expect(keyAct(key("I", chord), focus({ card: C1, inText: true }))).toEqual({
      kind: "takeIntoInventory",
      card: C1,
    })
    expect(keyAct(key("I", chord), focus())).toBeNull()
    expect(keyAct(key("O", chord), focus({ inText: true }))).toEqual({
      kind: "put",
      card: C2,
      target: { kind: "column", key: "k-1" },
    })
    expect(keyAct(key("O", chord), focus({ column: null }))).toBeNull()
    expect(
      keyAct(key("I", { ...chord, metaKey: true }), focus({ card: C1 })),
    ).toBeNull()
  })

  test("undo and redo with Meta or Ctrl, only outside a text box; in the panel, the panel's", () => {
    const undo = { kind: "undoMove", direction: "undo", inPanel: false }
    const redo = { kind: "undoMove", direction: "redo", inPanel: false }
    expect(
      keyAct(key("z", { metaKey: true }), focus({ inPanel: true })),
    ).toEqual({ ...undo, inPanel: true })
    expect(keyAct(key("z", { metaKey: true }), focus())).toEqual(undo)
    expect(keyAct(key("z", { ctrlKey: true }), focus())).toEqual(undo)
    expect(
      keyAct(key("Z", { metaKey: true, shiftKey: true }), focus()),
    ).toEqual(redo)
    expect(
      keyAct(key("Z", { ctrlKey: true, shiftKey: true }), focus()),
    ).toEqual(redo)
    expect(keyAct(key("y", { ctrlKey: true }), focus())).toEqual(redo)
    expect(
      keyAct(key("z", { metaKey: true }), focus({ inText: true })),
    ).toBeNull()
    expect(keyAct(key("z"), focus())).toBeNull()
  })

  test("a grid's keys are its own (`gridKeyAct`): none here", () => {
    expect(keyAct(key("l"), focus({ inPanel: true }))).toBeNull()
    expect(keyAct(key("ArrowUp"), focus({ inPanel: true }))).toBeNull()
  })
})

test("while a page covers the stage only the list's fold acts (ADR-0098)", () => {
  const onPage = focus({ page: true, card: C1 })
  expect(keyAct(key("L", chord), onPage)).toEqual({ kind: "foldList" })
  expect(keyAct(key("I", chord), onPage)).toBeNull()
  expect(keyAct(key("O", chord), onPage)).toBeNull()
  expect(keyAct(key("z", { metaKey: true }), onPage)).toBeNull()
})

describe("keyAct: search (ADR-0101)", () => {
  const open = { kind: "search", act: { kind: "open" } }
  const close = { kind: "search", act: { kind: "close" } }
  test.each<[string, KeyLike, Partial<KeyFocus>, unknown]>([
    ["/ opens it", key("/"), {}, open],
    ["/ in a box is text", key("/"), { inText: true }, null],
    [
      "/ with no tree shown does nothing",
      key("/"),
      { search: "unavailable" },
      null,
    ],
    ["/ while open focuses it again", key("/"), { search: "open" }, open],
    ["/ under a page does nothing", key("/"), { page: true }, null],
    ["/ with a modifier is not it", key("/", { metaKey: true }), {}, null],
    [
      "Escape in the search closes it",
      key("Escape"),
      { search: "focused" },
      close,
    ],
    [
      "Escape in its field closes it",
      key("Escape"),
      { search: "focused", inText: true },
      close,
    ],
    ["Escape elsewhere is not it", key("Escape"), { search: "open" }, null],
    ["Escape with no search is not it", key("Escape"), {}, null],
  ])("%s", (_, k, f, intent) => {
    expect(keyAct(k, focus(f))).toEqual(intent)
  })
})
