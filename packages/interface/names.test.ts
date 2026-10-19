import {
  entryId,
  PRODUCT_NAME,
  type TranscriptMessage,
  writerId,
} from "@pinetrie/core"
import { FIXTURE_THREAD } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { speakerLabel, speakerWords, writerNames } from "./names.ts"

describe("speakerLabel: the current name, and the one it was sent under", () => {
  const names = new Map([["w-duane", "Duane"]])
  test("renamed since: the current name, then the sent one in parentheses", () => {
    expect(speakerLabel(names, "w-duane", "guest-x4bu")).toBe(
      "Duane (guest-x4bu)",
    )
  })
  test("unchanged: just the name", () => {
    expect(speakerLabel(names, "w-duane", "Duane")).toBe("Duane")
  })
  test("no current name, or no writer: the name as sent", () => {
    expect(speakerLabel(names, "w-someone", "Bea")).toBe("Bea")
    expect(speakerLabel(names, undefined, "Bea")).toBe("Bea")
  })
})

test("writerNames: each writer by their current name, in order", () => {
  const nameOf = new Map([[writerId("ada@x.io"), "Ada"]])
  const ADA = writerId("ada@x.io")
  const BEA = writerId("bea@x.io")
  expect(writerNames(nameOf, [ADA, BEA])).toBe("Ada, bea")
})

describe("speakerWords: who a message is from, as its column names it", () => {
  const ADA = writerId("ada@x.io")
  const BEA = writerId("bea@x.io")
  const nameOf = new Map([[ADA, "Ada"]])
  const at = { id: entryId("1"), thread: FIXTURE_THREAD, text: "" }
  const person = (
    more: Partial<Extract<TranscriptMessage, { role: "person" }>>,
  ): TranscriptMessage => ({
    ...at,
    role: "person",
    author: "ada",
    compelled: false,
    writer: ADA,
    sendId: "s-1",
    ...more,
  })
  test.each<[string, TranscriptMessage, string]>([
    ["a person, by their name now", person({}), "Ada (ada)"],
    [
      "with those who wrote it with them",
      person({ author: "Ada", contributors: [BEA] }),
      "Ada, with bea",
    ],
    ["the agent", { ...at, role: "assistant" }, "agent"],
    [
      "a host's line, as pine·trie",
      { ...at, role: "update", merged: [] },
      PRODUCT_NAME,
    ],
    ["a host's fact, as pine·trie", { ...at, role: "fact" }, PRODUCT_NAME],
    [
      "another thread's ask, by its asker",
      { ...at, role: "relay", author: "amber-fox", from: FIXTURE_THREAD },
      "amber-fox",
    ],
    [
      "an answer, by the thread that answered",
      { ...at, role: "answer", author: "copper-owl", from: FIXTURE_THREAD },
      "copper-owl",
    ],
    ["pi's own user message, by its role", { ...at, role: "user" }, "user"],
  ])("%s", (_, message, words) => {
    expect(speakerWords(message, nameOf)).toBe(words)
  })
})
