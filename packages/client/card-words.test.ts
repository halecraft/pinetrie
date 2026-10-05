import {
  atEntry,
  type CardEvent,
  cardId,
  entryId,
  laneNameForThread,
  type PlaceKey,
  rootIdFor,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import type { CardRefusal } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import {
  cardStatus,
  commandNote,
  commandWords,
  historyWords,
  movedBackWords,
  pinnedMarkerWords,
  pinnedStatusWords,
  pinnedWords,
  queuedWords,
  refusalWords,
  retiredWords,
  sizeWords,
  traceWords,
  unsentWords,
  writtenWords,
} from "./card-words.ts"
import type { TraceGroup } from "./traces.ts"

const ME = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const READER = { me: ME, nameOf: new Map([[BEA, "Bea"]]) }
type MoveRefused = Extract<CardRefusal, { fromQueue: boolean }>
const refusal = (over: Partial<MoveRefused>): CardRefusal => ({
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
      "catch up with accepted work",
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
      "continue from accepted work",
    ],
    [
      "commandNote",
      commandNote("bring-up-to-date", { base: { kind: "line" }, parent: null }),
      "↓ catches up with accepted work first, then sends what you write",
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
      "refusalWords, an unqueue the pop beat, yours",
      refusalWords(refusal({ by: ME }), READER),
      "already sent as your message, before you unqueued it",
    ],
    [
      "refusalWords, an unqueue the pop beat, Bea's",
      refusalWords(refusal({ by: BEA }), READER),
      "already sent as Bea's message, before you unqueued it",
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

describe("history and traces (ADR-0048 step 6)", () => {
  const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const drafting: PlaceKey = {
    kind: "drafting",
    root: ROOT,
    at: atEntry(entryId("e-1")),
    lane: laneNameForThread("x"),
  }
  const queued: PlaceKey = {
    kind: "queued",
    root: ROOT,
    at: atEntry(entryId("e-1")),
    lane: laneNameForThread("x"),
    seen: "",
  }
  const event = (over: Partial<CardEvent>): CardEvent => ({
    kind: "moved",
    by: BEA,
    from: drafting,
    to: queued,
    at: 1,
    ...over,
  })
  test.each([
    [event({ kind: "created", by: ME, from: null }), "created by you"],
    [event({}), "queued by Bea"],
    [event({ from: queued, to: drafting }), "unqueued by Bea"],
    [event({ to: { kind: "inventory", holder: BEA } }), "taken by Bea"],
    [
      event({ kind: "undone", from: queued, to: drafting }),
      "unqueued by Bea (an undo)",
    ],
    [
      event({ kind: "unsent", by: null, from: queued, to: drafting }),
      "not sent: back below the line",
    ],
    [event({ kind: "followed", by: null }), "moved to the new thread"],
  ] as const)("historyWords: %o", (e, words) => {
    expect(historyWords(e, READER)).toBe(words)
  })

  const trace = (to: PlaceKey | null) => ({
    id: "t",
    for: ME,
    card: cardId("c-1"),
    by: BEA,
    from: drafting,
    to,
    message: null,
    at: 1,
  })
  test.each([
    [{ by: BEA, verb: "queued", traces: [trace(queued)] }, "Bea queued this"],
    [{ by: BEA, verb: "sent", traces: [trace(null)] }, "Bea sent this →"],
    [
      { by: BEA, verb: "took-into-inventory", traces: [trace(null)] },
      "Bea took this",
    ],
    [
      {
        by: BEA,
        verb: "moved",
        traces: [trace(null), trace(null), trace(null)],
      },
      "3 cards moved by Bea",
    ],
  ] as const)("traceWords: %#", (group, words) => {
    expect(traceWords(group as TraceGroup, READER)).toBe(words)
  })

  test("movedBackWords and writtenWords", () => {
    expect(movedBackWords({ verb: "unpinned", by: BEA }, READER)).toBe(
      "unpinned by Bea",
    )
    expect(writtenWords([ME, BEA], READER)).toBe("written by you, Bea")
    expect(writtenWords([], READER)).toBeNull()
  })
})
