import { PRODUCT_NAME, writerId } from "@pinetrie/core"
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
  test.each<[string, Parameters<typeof speakerWords>[0], string]>([
    [
      "a person, by their name now",
      { role: "person", writer: ADA, author: "ada" },
      "Ada (ada)",
    ],
    [
      "with those who wrote it with them",
      { role: "person", writer: ADA, author: "Ada", contributors: [BEA] },
      "Ada, with bea",
    ],
    ["the agent", { role: "assistant" }, "agent"],
    ["a host's line, as pine·trie", { role: "update" }, PRODUCT_NAME],
    ["a host's fact, as pine·trie", { role: "fact" }, PRODUCT_NAME],
    [
      "another thread's ask, by its asker",
      { role: "relay", author: "amber-fox" },
      "amber-fox",
    ],
    [
      "an answer, by the thread that answered",
      { role: "answer", author: "copper-owl" },
      "copper-owl",
    ],
    ["a role it does not know, by the role", { role: "other" }, "other"],
  ])("%s", (_, message, words) => {
    expect(speakerWords(message, nameOf)).toBe(words)
  })
})
