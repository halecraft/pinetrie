import { expect, test } from "vitest"
import { askAtTop, sameAtTop } from "./ask-bar.ts"

const works = [
  { ask: "a", top: -900, bottom: -100 },
  { ask: "b", top: -100, bottom: 400 },
]

test("askAtTop: the ask whose work is at the top, when its message is above", () => {
  expect(askAtTop(works, new Map([["b", -150]]))).toEqual({
    kind: "here",
    ask: "b",
  })
})

test("askAtTop: its message in a column to the left is named elsewhere", () => {
  expect(askAtTop(works, new Map())).toEqual({ kind: "elsewhere", ask: "b" })
})

test("askAtTop: nothing when its message shows, or no work is at the top", () => {
  expect(askAtTop([{ ask: "b", top: 20, bottom: 400 }], new Map())).toBeNull()
  expect(
    askAtTop([{ ask: "b", top: -10, bottom: 400 }], new Map([["b", 0]])),
  ).toBeNull()
})

test("sameAtTop", () => {
  expect(sameAtTop(null, null)).toBe(true)
  expect(
    sameAtTop({ kind: "here", ask: "a" }, { kind: "here", ask: "a" }),
  ).toBe(true)
  expect(
    sameAtTop({ kind: "here", ask: "a" }, { kind: "elsewhere", ask: "a" }),
  ).toBe(false)
})
