import { cardIdOfKind } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { NO_FOCUS } from "./fixtures.ts"
import type { Focus } from "./focus.ts"
import { type KeyLike, keyAct } from "./page-keys.ts"

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
const focus = (over: Partial<Focus> = {}): Focus => ({
  ...NO_FOCUS,
  selectedCard: C2,
  column: "k-1",
  search: "closed",
  ...over,
})
const chord = { ctrlKey: true, shiftKey: true }

describe("keyAct", () => {
  test("Cmd+C, Cmd+X and Cmd+V are no keys here: they are the page's copy, cut and paste events", () => {
    for (const k of ["c", "x", "v"]) {
      expect(keyAct(key(k, { metaKey: true }), focus({ card: C1 }))).toBeNull()
      expect(keyAct(key(k, { ctrlKey: true }), focus({ card: C1 }))).toBeNull()
    }
  })

  test("the put key in a text box puts the card in your hand in the column: only a paste types into a box", () => {
    const REF = cardIdOfKind(
      "reference",
      "01a0ffd2-0000-7000-8000-0000000000e1",
    )
    expect(
      keyAct(key("O", chord), focus({ selectedCard: REF, inText: true })),
    ).toEqual({
      kind: "put",
      source: { kind: "card", card: REF },
      target: { kind: "column", key: "k-1" },
      how: "move",
    })
  })

  test("Ctrl+Shift+L folds or unfolds the sidebar, in a text box too, and not with Meta or Alt", () => {
    const fold = { kind: "fold-list" }
    expect(keyAct(key("L", chord), focus())).toEqual(fold)
    expect(keyAct(key("L", chord), focus({ inText: true }))).toEqual(fold)
    expect(keyAct(key("L", { ...chord, metaKey: true }), focus())).toBeNull()
    expect(keyAct(key("L", { ...chord, altKey: true }), focus())).toBeNull()
    expect(keyAct(key("l", { ctrlKey: true }), focus())).toBeNull()
  })

  test("Ctrl+Shift+I takes the focused card, in a text box too; Ctrl+Shift+O puts the selected one in the last focused column", () => {
    expect(keyAct(key("I", chord), focus({ card: C1, inText: true }))).toEqual({
      kind: "put-away",
      card: C1,
    })
    expect(keyAct(key("I", chord), focus())).toBeNull()
    expect(keyAct(key("O", chord), focus({ inText: true }))).toEqual({
      kind: "put",
      source: { kind: "card", card: C2 },
      target: { kind: "column", key: "k-1" },
      how: "move",
    })
    expect(keyAct(key("O", chord), focus({ column: null }))).toBeNull()
    expect(
      keyAct(key("I", { ...chord, metaKey: true }), focus({ card: C1 })),
    ).toBeNull()
  })

  test("undo and redo with Meta or Ctrl, only outside a text box; in the panel, the panel's", () => {
    const undo = { kind: "undo-move", direction: "undo", inPanel: false }
    const redo = { kind: "undo-move", direction: "redo", inPanel: false }
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

  test("Alt+→ and Alt+← move the column focus is in one place, never past an end, nor in a text box or the panel", () => {
    const T = cardIdOfKind("thread", "a")
    const inColumn = { card: T, position: 1, count: 3 }
    const alt = (k: string) => key(k, { altKey: true })
    expect(keyAct(alt("ArrowRight"), focus({ inColumn }))).toEqual({
      kind: "move-column",
      column: { kind: "card", card: T },
      to: 2,
    })
    expect(keyAct(alt("ArrowLeft"), focus({ inColumn }))).toMatchObject({
      to: 0,
    })
    expect(
      keyAct(
        alt("ArrowLeft"),
        focus({ inColumn: { ...inColumn, position: 0 } }),
      ),
    ).toBeNull()
    expect(
      keyAct(alt("ArrowRight"), focus({ inColumn, inText: true })),
    ).toBeNull()
    expect(
      keyAct(alt("ArrowRight"), focus({ inColumn, inPanel: true })),
    ).toBeNull()
    expect(keyAct(key("ArrowRight"), focus({ inColumn }))).toBeNull()
    expect(keyAct(alt("ArrowRight"), focus())).toBeNull()
  })

  test("a grid's keys are its own (`gridKeyAct`): none here", () => {
    expect(keyAct(key("l"), focus({ inPanel: true }))).toBeNull()
    expect(keyAct(key("ArrowUp"), focus({ inPanel: true }))).toBeNull()
  })
})

test("while a page covers the stage only the list's fold acts", () => {
  const onPage = focus({ page: true, card: C1 })
  expect(keyAct(key("L", chord), onPage)).toEqual({ kind: "fold-list" })
  expect(keyAct(key("I", chord), onPage)).toBeNull()
  expect(keyAct(key("O", chord), onPage)).toBeNull()
  expect(keyAct(key("z", { metaKey: true }), onPage)).toBeNull()
})

describe("keyAct: search", () => {
  const open = { kind: "search", act: { kind: "open" } }
  const close = { kind: "search", act: { kind: "close" } }
  test.each<[string, KeyLike, Partial<Focus>, unknown]>([
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

describe("keyAct: the inventory", () => {
  const escapes = { kind: "inventory", act: { kind: "escape" } }
  test.each<[string, KeyLike, Partial<Focus>, unknown]>([
    [
      "Escape in the panel is the panel's",
      key("Escape"),
      { inPanel: true },
      escapes,
    ],
    [
      "Escape in the bench's box is the panel's too",
      key("Escape"),
      { inPanel: true, inText: true },
      escapes,
    ],
    ["Escape outside it is not", key("Escape"), {}, null],
  ])("%s", (_, k, f, intent) => {
    expect(keyAct(k, focus(f))).toEqual(intent)
  })
})
