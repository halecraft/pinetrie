import { entryId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { askAtTop, sameAtTop } from "./ask-bar.ts"

const works = [
  { ask: entryId("a"), top: -900, bottom: -100 },
  { ask: entryId("b"), top: -100, bottom: 400 },
]

test("askAtTop: the ask whose work is at the top, when its message is above", () => {
  expect(askAtTop(works, new Map([[entryId("b"), -150]]))).toEqual({
    kind: "here",
    ask: "b",
  })
})

test("askAtTop: its message in a column to the left is named elsewhere", () => {
  expect(askAtTop(works, new Map())).toEqual({ kind: "elsewhere", ask: "b" })
})

test("askAtTop: nothing when its message shows, or no work is at the top", () => {
  expect(
    askAtTop([{ ask: entryId("b"), top: 20, bottom: 400 }], new Map()),
  ).toBeNull()
  expect(
    askAtTop(
      [{ ask: entryId("b"), top: -10, bottom: 400 }],
      new Map([[entryId("b"), 0]]),
    ),
  ).toBeNull()
})

test("sameAtTop", () => {
  expect(sameAtTop(null, null)).toBe(true)
  expect(
    sameAtTop(
      { kind: "here", ask: entryId("a") },
      { kind: "here", ask: entryId("a") },
    ),
  ).toBe(true)
  expect(
    sameAtTop(
      { kind: "here", ask: entryId("a") },
      { kind: "elsewhere", ask: entryId("a") },
    ),
  ).toBe(false)
})
