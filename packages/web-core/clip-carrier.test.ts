import { entryId, threadIdFor } from "@pinetrie/core"
import type { Clip } from "@pinetrie/interface"
import { describe, expect, test } from "vitest"
import { planCopy, type Received, readPaste } from "./clip-carrier.ts"

const HOST = "https://pinetrie.example"
const entryAddress = {
  kind: "entry",
  thread: threadIdFor("1-r1"),
  entry: entryId("2-a"),
} as const

describe("the carrier", () => {
  const clip: Clip = {
    kind: "past",
    taken: { address: entryAddress, markdown: "two\nlines" },
  }
  const write = planCopy(clip, null, { nonce: "n1", host: HOST })
  const received = (over: Partial<Received> = {}): Received => ({
    custom: write.custom,
    attribute: null,
    plain: write.plain,
    plainOnly: false,
    ...over,
  })

  test("a copy writes its text, the text escaped in an element carrying the carrier, and the carrier", () => {
    expect(write.plain).toBe("two\nlines")
    expect(write.html).toContain('data-pinetrie="')
    expect(write.html).toContain("white-space: pre-wrap")
    expect(
      planCopy(clip, "<b>tw</b>", { nonce: "n1", host: HOST }).html,
    ).toMatch(/^<div data-pinetrie="[^"]*"><b>tw<\/b><\/div>$/)
  })

  test("a paste reads the custom type, else the attribute, back to the clip", () => {
    expect(readPaste(received(), HOST)).toEqual(clip)
    expect(
      readPaste(received({ custom: "", attribute: write.custom }), HOST),
    ).toEqual(clip)
  })

  test("text from elsewhere: no carrier, or one on other text, from another host, malformed, or Shift held", () => {
    const text = (plain: string): Clip => ({
      kind: "text",
      text: plain,
      origin: null,
    })
    expect(readPaste(received({ custom: "" }), HOST)).toEqual(text(write.plain))
    expect(readPaste(received({ plain: "changed" }), HOST)).toEqual(
      text("changed"),
    )
    expect(readPaste(received(), "https://other.example")).toEqual(
      text(write.plain),
    )
    expect(readPaste(received({ custom: "{not json" }), HOST)).toEqual(
      text(write.plain),
    )
    expect(readPaste(received({ plainOnly: true }), HOST)).toEqual(
      text(write.plain),
    )
  })

  test("a system clipboard's \\r\\n still matches the carrier's \\n", () => {
    expect(readPaste(received({ plain: "two\r\nlines" }), HOST)).toEqual(clip)
  })
})
