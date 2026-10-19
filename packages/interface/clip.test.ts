import {
  type CardRecord,
  cardIdOfKind,
  entryId,
  entryMessage,
  type Sha256,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { addressLink } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  type Clip,
  type ClipFacts,
  clipOfFocus,
  planCopy,
  type Received,
  readPaste,
} from "./clip.ts"
import { NO_FOCUS, tree } from "./fixtures.ts"
import type { Focus } from "./focus.ts"
import { addressMarkdown } from "./markdown-of.ts"

const ADA = writerId("ada@x.io")
const HOST = "https://pinetrie.example"
const index = tree({ "1-r1": null, "2-a": "1-r1" })
const A = entryId("2-a")
const THREAD = threadIdFor("1-r1")
const TEXT = textCardId("01a0ffd2-0000-7000-8000-0000000000c1")
const REF = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
const SHA = "a".repeat(64) as Sha256
const entryAddress = { kind: "entry", thread: THREAD, entry: A } as const
const cards: readonly CardRecord[] = [
  {
    kind: "text",
    id: TEXT,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    content: { command: null, unsent: null, origin: null },
  },
  {
    kind: "reference",
    id: REF,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    content: { address: entryAddress, quote: SHA },
  },
]
const facts = (over: Partial<ClipFacts> = {}): ClipFacts => ({
  me: ADA,
  cards,
  index,
  lanes: [],
  textOf: () => "a note",
  quoteOf: () => null,
  cell: null,
  ...over,
})
const focus = (over: Partial<Focus> = {}): Focus => ({ ...NO_FOCUS, ...over })
const copied = (f: Partial<Focus>, over: Partial<ClipFacts> = {}) =>
  clipOfFocus(focus(f), facts(over), false)

describe("what a copy takes (`clipOfFocus`)", () => {
  test("a text box, and a selection outside any message, are the browser's own copy", () => {
    expect(copied({ inText: true, card: TEXT })).toEqual({ kind: "browser" })
    expect(copied({ selection: { entry: null, text: "x" } })).toEqual({
      kind: "browser",
    })
  })

  test("a selection in a message is its text, its origin the range it names; it beats a focused block", () => {
    const block = { entry: "2-a", block: { kind: "paragraph", n: 0 } } as const
    expect(copied({ selection: { entry: "2-a", text: "2-" }, block })).toEqual({
      kind: "clip",
      clip: {
        kind: "text",
        text: "2-",
        origin: { kind: "range", thread: THREAD, entry: A, from: 0, to: 2 },
      },
    })
    expect(
      copied({ selection: { entry: "2-a", text: "**2**" } }),
    ).toMatchObject({ clip: { kind: "text", origin: entryAddress } })
  })

  test("a focused block beats the selected message, which beats a focused card", () => {
    expect(
      copied({
        block: { entry: "2-a", block: { kind: "paragraph", n: 0 } },
        selected: "1-r1",
        card: TEXT,
      }),
    ).toMatchObject({
      clip: { kind: "past", taken: { address: { kind: "block" } } },
    })
    expect(copied({ selected: "2-a", card: TEXT })).toEqual({
      kind: "clip",
      clip: {
        kind: "past",
        taken: {
          address: entryAddress,
          markdown: addressMarkdown(entryAddress, {
            messageOf: e => entryMessage(index, e) ?? undefined,
          }),
        },
      },
    })
    expect(copied({ card: TEXT })).toEqual({
      kind: "clip",
      clip: {
        kind: "card",
        of: { kind: "text", card: TEXT, text: "a note" },
        cut: false,
      },
    })
  })

  test("a reference's text is its quote when fetched, else its link", () => {
    const link = addressLink(entryAddress, "a message")
    expect(copied({ card: REF })).toMatchObject({
      clip: { of: { kind: "reference", quote: SHA, text: link } },
    })
    expect(copied({ card: REF }, { quoteOf: () => "quoted" })).toMatchObject({
      clip: { of: { text: "quoted" } },
    })
  })

  test("a cut takes only a card you may trash; the past is left to the browser", () => {
    expect(clipOfFocus(focus({ card: TEXT }), facts(), true)).toMatchObject({
      clip: { kind: "card", cut: true },
    })
    expect(clipOfFocus(focus({ selected: "2-a" }), facts(), true)).toEqual({
      kind: "browser",
    })
  })
})

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
