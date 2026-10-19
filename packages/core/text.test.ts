import { expect, test } from "vitest"
import { firstLine } from "./text.ts"

test("firstLine: the first non-empty line, cut with an ellipsis only when longer", () => {
  expect(firstLine("\n  Plan the release \nand more", 40)).toBe(
    "Plan the release",
  )
  expect(firstLine("abcdef", 3)).toBe("abc…")
  expect(firstLine("abc", 3)).toBe("abc")
  expect(firstLine("  \n ", 3)).toBe("")
})
