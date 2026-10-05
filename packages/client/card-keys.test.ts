import { cardId } from "@pineta/core"
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
