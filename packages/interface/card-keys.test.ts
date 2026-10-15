import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { cardKeyAct, newCardKeys } from "./card-keys.ts"

const key = (
  k: string,
  over: Partial<Parameters<typeof cardKeyAct>[0]> = {},
) => ({
  key: k,
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  ...over,
})
const C = cardIdFor("c1")
const among = [cardIdFor("c0"), C]

test("Alt+↑ and Alt+↓ move the card one place; anything else is the box's own", () => {
  expect(cardKeyAct(key("ArrowUp"), C, among)).toEqual({
    kind: "reorder",
    card: C,
    among,
    step: -1,
  })
  expect(cardKeyAct(key("ArrowDown"), C, among)).toMatchObject({ step: 1 })
  expect(cardKeyAct(key("ArrowUp", { altKey: false }), C, among)).toBeNull()
  expect(cardKeyAct(key("ArrowUp", { shiftKey: true }), C, among)).toBeNull()
  expect(cardKeyAct(key("ArrowUp", { metaKey: true }), C, among)).toBeNull()
  expect(cardKeyAct(key("ArrowUp", { isComposing: true }), C, among)).toBeNull()
  expect(cardKeyAct(key("ArrowLeft"), C, among)).toBeNull()
})

test("Ctrl+Shift+Backspace discards any card; a card with no place in line takes no Alt+↑", () => {
  const discard = key("Backspace", {
    altKey: false,
    ctrlKey: true,
    shiftKey: true,
  })
  expect(cardKeyAct(discard, C, null)).toEqual({ kind: "discard", card: C })
  expect(cardKeyAct(discard, C, among)).toEqual({ kind: "discard", card: C })
  expect(cardKeyAct({ ...discard, metaKey: true }, C, null)).toBeNull()
  expect(cardKeyAct({ ...discard, shiftKey: false }, C, null)).toBeNull()
  expect(cardKeyAct(key("ArrowUp"), C, null)).toBeNull()
})

test("in a new card's box, a move hands the card to its list, focused; a discard lets it go; any other key keeps it", () => {
  expect(newCardKeys(key("ArrowUp"), C, among)).toEqual({
    acts: [
      { kind: "reorder", card: C, among, step: -1 },
      { kind: "focusCard", card: C },
    ],
    release: true,
  })
  expect(
    newCardKeys(
      key("Backspace", { altKey: false, ctrlKey: true, shiftKey: true }),
      C,
      among,
    ),
  ).toEqual({ acts: [{ kind: "discard", card: C }], release: true })
  expect(newCardKeys(key("a", { altKey: false }), C, among)).toEqual({
    acts: [],
    release: false,
  })
})
