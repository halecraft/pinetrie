import { expect, test } from "vitest"
import { markedText, VERIFY_PARSERS } from "./verify-parsers.ts"

const parse = (id: string, output: string) =>
  VERIFY_PARSERS.find(p => p.id === id)?.parse(output, 0) ?? null

test("a parser reads its marked line among other output, wherever it came", () => {
  const output = [
    "  linux (Linux): 3 here",
    "requirements: 5 here · 48 in a lane",
    "a warning on stderr, arrived after it",
  ].join("\n")
  expect(parse("requirements", output)).toEqual({
    summary: "5 here · 48 in a lane",
  })
  expect(parse("suite", "=== e2e: pass=2 ===\nsuite: 2 passed\n")).toEqual({
    summary: "2 passed",
  })
})

test("a parser without its marked line gives null", () => {
  expect(parse("requirements", "Tests  3 passed (3)\n")).toBeNull()
  expect(markedText("", "suite: ")).toBeNull()
})
