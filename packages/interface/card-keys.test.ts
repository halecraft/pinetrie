import { cardId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { cardKeyAct } from "./card-keys.ts"

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
const C = cardId("c-1")
const among = [cardId("c-0"), C]

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
