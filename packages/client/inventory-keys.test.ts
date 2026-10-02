import { cardId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { type KeyFocus, type KeyLike, keyAct } from "./inventory-keys.ts"

const C1 = cardId("c-1")
const C2 = cardId("c-2")
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
  selected: 7,
  selectedCard: C2,
  column: "k-1",
  ...over,
})
const chord = { ctrlKey: true, shiftKey: true }

describe("keyAct", () => {
  test("Ctrl+Shift+I takes the focused card, in a text box too; Ctrl+Shift+O puts the selected one in the last focused column", () => {
    expect(keyAct(key("I", chord), focus({ card: C1, inText: true }))).toEqual({
      kind: "take",
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

  test("undo and redo with Meta or Ctrl, only outside a text box", () => {
    const undo = { kind: "undoMove", direction: "undo", restored: null }
    const redo = { kind: "undoMove", direction: "redo", restored: null }
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

  test("arrows and hjkl move through the grid only while the panel has focus", () => {
    expect(keyAct(key("l"), focus({ inPanel: true }))).toEqual({
      kind: "selectSlot",
      slot: 8,
    })
    expect(keyAct(key("ArrowUp"), focus({ inPanel: true }))).toEqual({
      kind: "selectSlot",
      slot: 1,
    })
    expect(keyAct(key("l"), focus())).toBeNull()
    expect(keyAct(key("l"), focus({ inPanel: true, inText: true }))).toBeNull()
  })
})
