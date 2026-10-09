import {
  atEntry,
  type CardEvent,
  entryId,
  noteColumnIdFor,
  type PlaceKey,
  rootIdFor,
  type ThreadName,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { CardNotice } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import {
  commandNote,
  commandWords,
  historyWords,
  movedBackWords,
  noticeWords,
  pinnedMarkerWords,
  pinnedStatusWords,
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
type MoveRefused = Extract<CardNotice, { fromQueue: boolean }>
const refusal = (over: Partial<MoveRefused>): CardNotice => ({
  card: cardIdFor("c1"),
  actedAt: { kind: "inventory" },
  code: "gone",
  by: null,
  fromQueue: true,
  ...over,
})

describe("card words", () => {
  test.each([
    [
      "commandWords, on accepted work",
      commandWords("bring-up-to-date", {
        base: { kind: "accepted" },
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
      commandWords("continue-on-accepted", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "continue from accepted work",
    ],
    [
      "commandNote",
      commandNote("bring-up-to-date", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "↓ catches up with accepted work first, then sends what you write",
    ],
    [
      "commandWords, the thread it branched from (ADR-0072)",
      commandWords("catch-up-with-parent", {
        base: { kind: "accepted" },
        parent: {
          kind: "parent",
          lane: threadIdFor("p"),
          name: "amber-fox" as ThreadName,
        },
      }),
      "catch up with amber-fox",
    ],
    [
      "commandNote, the thread it branched from, unknown",
      commandNote("catch-up-with-parent", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "↓ catches up with the thread this one branched from first, then sends what you write",
    ],
    ["unsentWords", unsentWords("no such image"), "not sent: no such image"],
    [
      "noticeWords, an unqueue the pop beat, yours",
      noticeWords(refusal({ by: ME }), READER),
      "already sent as your message, before you unqueued it",
    ],
    [
      "noticeWords, an unqueue the pop beat, Bea's",
      noticeWords(refusal({ by: BEA }), READER),
      "already sent as Bea's message, before you unqueued it",
    ],
    [
      "noticeWords, gone from a note",
      noticeWords(refusal({ fromQueue: false }), READER),
      "not moved: it was sent or discarded first",
    ],
    [
      "noticeWords, moved by Bea first",
      noticeWords(refusal({ code: "moved", by: BEA }), READER),
      "not moved: Bea moved it first",
    ],
    [
      "noticeWords, moved by you in another tab",
      noticeWords(refusal({ code: "moved", by: ME }), READER),
      "not moved: you moved it first",
    ],
    [
      "noticeWords, your discard",
      noticeWords(
        { card: null, actedAt: { kind: "inventory" }, code: "discarded" },
        READER,
      ),
      "discarded · the undo key (⌘Z outside a box) brings it back",
    ],
    [
      "noticeWords, a full inventory",
      noticeWords(refusal({ code: "full" }), READER),
      "inventory full",
    ],
  ])("%s", (_, words, expected) => {
    expect(words).toBe(expected)
  })
})

describe("pinned card words (ADR-0048 step 5)", () => {
  const card = { id: textCardId("p-1"), text: "x", by: ME }
  test.each([
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
  const _ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const atEnd: PlaceKey = {
    kind: "note",
    column: noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
  }
  const queued: PlaceKey = {
    kind: "queued",
    at: atEntry(entryId("e-1")),
    thread: threadIdFor("x"),
    seen: "",
  }
  const event = (over: Partial<CardEvent>): CardEvent => ({
    kind: "moved",
    by: BEA,
    from: atEnd,
    to: queued,
    at: 1,
    ...over,
  })
  test.each([
    [event({ kind: "created", by: ME, from: null }), "created by you"],
    [event({}), "queued by Bea"],
    [event({ from: queued, to: atEnd }), "unqueued by Bea"],
    [event({ to: { kind: "inventory", holder: BEA } }), "taken by Bea"],
    [
      event({ kind: "undone", from: queued, to: atEnd }),
      "unqueued by Bea (an undo)",
    ],
    [
      event({ kind: "unsent", by: null, from: queued, to: atEnd }),
      "not sent: back below the line",
    ],
    [event({ kind: "followed", by: null }), "moved to the new thread"],
  ] as const)("historyWords: %o", (e, words) => {
    expect(historyWords(e, READER)).toBe(words)
  })

  const trace = (to: PlaceKey | null) => ({
    id: "t",
    for: ME,
    card: cardIdFor("c1"),
    by: BEA,
    from: queued,
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
