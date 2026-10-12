import { entryId, type TranscriptMessage, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { copyText } from "./copy-text.ts"
import { markdownOf } from "./markdown-of.ts"

const T = threadIdFor("a")
const E = entryId("e1")
const TEXT = "Here:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nThat's it."
const message: TranscriptMessage = {
  id: E,
  thread: T,
  role: "assistant",
  text: TEXT,
  toolCalls: [{ id: "c", name: "bash", subject: "ls" }],
} as unknown as TranscriptMessage
const facts = { messageOf: (id: string) => (id === E ? message : undefined) }

describe("markdownOf", () => {
  test("an entry's markdown is its copy, as `copyText` gives it", () => {
    const entry = markdownOf({ kind: "entry", thread: T, entry: E }, facts)
    expect(entry).toBe(copyText(message))
    // Its tool calls too, which its text alone leaves out.
    expect(entry).not.toBe(TEXT)
  })
  test("a block's is its source slice; a range's its slice of the text", () => {
    expect(
      markdownOf(
        { kind: "block", thread: T, entry: E, block: { kind: "table", n: 0 } },
        facts,
      ),
    ).toBe("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(
      markdownOf({ kind: "range", thread: T, entry: E, from: 0, to: 4 }, facts),
    ).toBe("Here")
  })
  test("a thread, a card, an entry not held, or a block not there: nothing", () => {
    expect(markdownOf({ kind: "thread", thread: T }, facts)).toBe("")
    expect(
      markdownOf({ kind: "entry", thread: T, entry: entryId("e2") }, facts),
    ).toBe("")
    expect(
      markdownOf(
        { kind: "block", thread: T, entry: E, block: { kind: "table", n: 1 } },
        facts,
      ),
    ).toBe("")
  })
})
