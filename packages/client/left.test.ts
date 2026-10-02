import { expect, test } from "vitest"
import { tree } from "./fixtures.ts"
import { decodeLeft, encodeLeft, leftLine, mergeLeft } from "./left.ts"

test("leftLine: before the first message below where it was left, which may be no message", () => {
  // a -> b -> r (a tool's result) -> c -> d, and a branch x off a.
  const index = tree({ a: null, b: "a", r: "b", c: "r", d: "c", x: "a" })
  const ids = ["a", "b", "c", "d"]
  expect(leftLine(index, "b", ids)).toBe("c")
  expect(leftLine(index, "r", ids)).toBe("c")
  expect(leftLine(index, "d", ids)).toBeNull()
  expect(leftLine(index, "x", ids)).toBeNull()
  expect(leftLine(index, undefined, ids)).toBeNull()
})

test("left: two tabs' saves merge, the later winning for its own lanes, and it round-trips", () => {
  const merged = mergeLeft(
    new Map([
      ["t-a", "1"],
      ["t-b", "2"],
    ]),
    new Map([["t-b", "3"]]),
  )
  expect([...merged]).toEqual([
    ["t-a", "1"],
    ["t-b", "3"],
  ])
  expect(decodeLeft(JSON.parse(JSON.stringify(encodeLeft(merged))))).toEqual(
    merged,
  )
  expect(decodeLeft({ v: 2, lanes: {} })).toBeUndefined()
})
