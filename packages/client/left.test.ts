import { entryId } from "@pineta/core"
import { expect, test } from "vitest"
import { tree } from "./fixtures.ts"
import { leftLine } from "./left.ts"

test("leftLine: before the first message below where it was left, which may be no message", () => {
  // a -> b -> r (a tool's result) -> c -> d, and a branch x off a.
  const index = tree({ a: null, b: "a", r: "b", c: "r", d: "c", x: "a" })
  const ids = [entryId("a"), entryId("b"), entryId("c"), entryId("d")]
  expect(leftLine(index, entryId("b"), ids)).toBe("c")
  expect(leftLine(index, entryId("r"), ids)).toBe("c")
  expect(leftLine(index, entryId("d"), ids)).toBeNull()
  expect(leftLine(index, entryId("x"), ids)).toBeNull()
  expect(leftLine(index, undefined, ids)).toBeNull()
})
