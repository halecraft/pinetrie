import { entryId, threadIdFor } from "@pinetrie/core"
import type { TranscriptMessage } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { copyText } from "./copy-text.ts"
import { addressMarkdown } from "./markdown-of.ts"

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

describe("addressMarkdown", () => {
  test("an entry's markdown is its copy, as `copyText` gives it", () => {
    const entry = addressMarkdown({ kind: "entry", thread: T, entry: E }, facts)
    expect(entry).toBe(copyText(message))
    // Its tool calls too, which its text alone leaves out.
    expect(entry).not.toBe(TEXT)
  })
  test("a block's is its source slice; a range's its slice of the text", () => {
    expect(
      addressMarkdown(
        { kind: "block", thread: T, entry: E, block: { kind: "table", n: 0 } },
        facts,
      ),
    ).toBe("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(
      addressMarkdown(
        { kind: "range", thread: T, entry: E, from: 0, to: 4 },
        facts,
      ),
    ).toBe("Here")
  })
  test("a thread, a card, an entry not held, or a block not there: nothing", () => {
    expect(addressMarkdown({ kind: "thread", thread: T }, facts)).toBe("")
    expect(
      addressMarkdown(
        { kind: "entry", thread: T, entry: entryId("e2") },
        facts,
      ),
    ).toBe("")
    expect(
      addressMarkdown(
        { kind: "block", thread: T, entry: E, block: { kind: "table", n: 1 } },
        facts,
      ),
    ).toBe("")
  })
})
