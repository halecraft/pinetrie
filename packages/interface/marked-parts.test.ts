import { expect, test } from "vitest"
import { markedParts } from "./marked-parts.ts"

test("a text is cut at its ranges, each part marked when inside one", () => {
  expect(markedParts("abcdef", [{ from: 1, to: 3 }])).toEqual([
    { text: "a", marked: false },
    { text: "bc", marked: true },
    { text: "def", marked: false },
  ])
})

test("a range reaching past the text is clipped to it", () => {
  expect(
    markedParts("abc", [
      { from: 2, to: 9 },
      { from: 5, to: 7 },
    ]),
  ).toEqual([
    { text: "ab", marked: false },
    { text: "c", marked: true },
  ])
})

test("a text with no ranges is one unmarked part, and an empty one none", () => {
  expect(markedParts("abc", [])).toEqual([{ text: "abc", marked: false }])
  expect(markedParts("", [{ from: 0, to: 1 }])).toEqual([])
})
