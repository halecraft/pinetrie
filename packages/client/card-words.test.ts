import {
  cardId,
  laneNameForThread,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { Refusal } from "./card-moves.ts"
import {
  cardStatus,
  commandNote,
  commandWords,
  pinnedMarkerWords,
  pinnedStatusWords,
  pinnedWords,
  queuedWords,
  refusalWords,
  retiredWords,
  sizeWords,
  unsentWords,
} from "./card-words.ts"

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
type MoveRefused = Extract<Refusal, { fromQueue: boolean }>
const refusal = (over: Partial<MoveRefused>): Refusal => ({
  card: cardId("c-1"),
  actedAt: { kind: "inventory" },
  code: "gone",
  by: null,
  fromQueue: true,
  ...over,
})

describe("card words", () => {
  test.each([
    [
      "commandWords, on the line",
      commandWords("bring-up-to-date", {
        base: { kind: "line" },
        parent: null,
      }),
      "catch up with the project",
    ],
    [
      "commandWords, on a WIP",
      commandWords("bring-up-to-date", {
        base: { kind: "wip", bookmark: "wip/a" },
        parent: null,
      }),
      "catch up with wip/a",
    ],
    [
      "commandWords, a WIP gone",
      commandWords("continue-on-line", {
        base: { kind: "line" },
        parent: null,
      }),
      "continue from the project",
    ],
    [
      "commandNote",
      commandNote("bring-up-to-date", { base: { kind: "line" }, parent: null }),
      "↓ catches up with the project first, then sends what you write",
    ],
    [
      "commandWords, the thread it branched from (ADR-0072)",
      commandWords("catch-up-with-parent", {
        base: { kind: "line" },
        parent: {
          kind: "parent",
          lane: laneNameForThread("p"),
          name: "amber-fox" as ThreadName,
        },
      }),
      "catch up with amber-fox",
    ],
    [
      "commandNote, the thread it branched from, unknown",
      commandNote("catch-up-with-parent", {
        base: { kind: "line" },
        parent: null,
      }),
      "↓ catches up with the thread this one branched from first, then sends what you write",
    ],
    [
      "queuedWords, yours",
      queuedWords(ME, 0, READER),
      "queued by you · 1st in line",
    ],
    [
      "queuedWords, Bea's",
      queuedWords(BEA, 1, READER),
      "queued by Bea · 2nd in line",
    ],
    ["unsentWords", unsentWords("no such image"), "not sent: no such image"],
    [
      "refusalWords, an unqueue the take beat, yours",
      refusalWords(refusal({ by: ME }), READER),
      "already sent as your message: it was taken before you unqueued it",
    ],
    [
      "refusalWords, an unqueue the take beat, Bea's",
      refusalWords(refusal({ by: BEA }), READER),
      "already sent as Bea's message: it was taken before you unqueued it",
    ],
    [
      "refusalWords, gone from a drafting place",
      refusalWords(refusal({ fromQueue: false }), READER),
      "not moved: it was sent or removed first",
    ],
    [
      "refusalWords, moved by Bea first",
      refusalWords(refusal({ code: "moved", by: BEA }), READER),
      "not moved: Bea moved it first",
    ],
    [
      "refusalWords, moved by you in another tab",
      refusalWords(refusal({ code: "moved", by: ME }), READER),
      "not moved: you moved it first",
    ],
    [
      "refusalWords, a full inventory",
      refusalWords(refusal({ code: "full" }), READER),
      "inventory full",
    ],
  ])("%s", (_, words, expected) => {
    expect(words).toBe(expected)
  })
})

test("cardStatus: the send's own status first; else why the host could not send the card", () => {
  expect(cardStatus("sending…", "no such image")).toBe("sending…")
  expect(cardStatus("", "no such image")).toBe("not sent: no such image")
  expect(cardStatus("", null)).toBe("")
})

describe("pinned card words (ADR-0048 step 5)", () => {
  const card = { id: cardId("p-1"), text: "x", by: ME }
  test.each([
    ["pinned by you", pinnedWords(ME, READER), "pinned by you"],
    ["pinned by another", pinnedWords(BEA, READER), "pinned by Bea"],
    ["read", pinnedStatusWords("read"), "read by the agent"],
    [
      "changed",
      pinnedStatusWords("changed"),
      "changed since the agent last read it",
    ],
    ["unread", pinnedStatusWords("unread"), "not read by the agent yet"],
    ["one token", sizeWords(1), "~1 token"],
    ["tokens", sizeWords(120), "~120 tokens"],
    [
      "a marker, one card",
      pinnedMarkerWords({ cards: [card], retired: [] }),
      "the agent read 1 pinned card",
    ],
    [
      "a marker, two cards",
      pinnedMarkerWords({ cards: [card, card], retired: [] }),
      "the agent read 2 pinned cards",
    ],
    [
      "a marker, every card unpinned",
      pinnedMarkerWords({ cards: [], retired: [{ id: card.id, line: "x" }] }),
      "the agent was told pinned cards no longer apply",
    ],
    [
      "retired",
      retiredWords("use the old schema"),
      "no longer applies: “use the old schema”",
    ],
  ])("%s", (_, said, expected) => {
    expect(said).toBe(expected)
  })
})
