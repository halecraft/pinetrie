import { entryId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  addressLink,
  addressLinks,
  linkedQuotes,
  pastMarkdown,
  withQuotes,
} from "./links.ts"

const T = threadIdFor("a")
const E = entryId("e1")
const BLOCK = {
  kind: "block",
  thread: T,
  entry: E,
  block: { kind: "table", n: 0 },
} as const

describe("links to addresses", () => {
  test("a put's link is found again in the text, with its label; one in code is text", () => {
    const text = `see ${addressLink(BLOCK, "the [plan] table")} and \`${addressLink(BLOCK, "x")}\``
    expect(addressLinks(text)).toEqual([
      { address: BLOCK, label: "the plan table" },
    ])
  })
  test("a past address's markdown is its slice of the message's text", () => {
    const text = "Here:\n\n| a |\n|---|\n| 1 |"
    expect(pastMarkdown(BLOCK, text)).toBe("| a |\n|---|\n| 1 |")
    expect(
      pastMarkdown(
        { kind: "range", thread: T, entry: E, from: 0, to: 4 },
        text,
      ),
    ).toBe("Here")
    expect(
      pastMarkdown({ ...BLOCK, block: { kind: "table", n: 1 } }, text),
    ).toBeNull()
  })
  test("the model reads each linked referent quoted under the message", () => {
    expect(
      withQuotes("Ada: look", [
        { kind: "link", label: "the table", markdown: "| a |\n\n| 1 |" },
        { kind: "link", label: "gone", markdown: "" },
        { kind: "share", label: "n.txt", markdown: "hi" },
      ]),
    ).toBe(
      "Ada: look\n\nLinked: the table\n> | a |\n>\n> | 1 |\n\nShared: n.txt\n> hi",
    )
    expect(withQuotes("Ada: look", [])).toBe("Ada: look")
  })
})

test("linkedQuotes: each past referent a message links to, from the message it is in", () => {
  const text = [
    addressLink(BLOCK, "the table"),
    addressLink({ kind: "thread", thread: T }, "a thread"),
    addressLink({ kind: "entry", thread: T, entry: entryId("gone") }, "gone"),
  ].join(" ")
  expect(
    linkedQuotes(text, a =>
      a.entry === E ? "Here:\n\n| a |\n|---|\n| 1 |" : undefined,
    ),
  ).toEqual([
    { kind: "link", label: "the table", markdown: "| a |\n|---|\n| 1 |" },
  ])
})
