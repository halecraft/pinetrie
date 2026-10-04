import { describe, expect, test } from "vitest"
import { outcomeWords } from "./outcome-words.ts"

describe("outcomeWords: one wording for every command the page waits on", () => {
  test.each([
    ["refused", "not done: no room"],
    ["failed", "it failed, and may be part done: no room"],
  ] as const)("a command %s is worded as such", (kind, words) => {
    expect(outcomeWords({ kind, message: "no room" })).toBe(words)
  })
})
