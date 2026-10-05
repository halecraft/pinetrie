import { describe, expect, test } from "vitest"
import { outcomeWords } from "./outcome-words.ts"

describe("outcomeWords: one wording for every command the page waits on", () => {
  test.each([
    [
      "refused",
      { kind: "refused", code: "refused", message: "no room" },
      "not done: no room",
    ],
    [
      "failed",
      { kind: "failed", message: "no room" },
      "it failed, and may be part done: no room",
    ],
  ] as const)("a command %s is worded as such", (_, said, words) => {
    expect(outcomeWords(said)).toBe(words)
  })
})
