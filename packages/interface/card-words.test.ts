import {
  cardIdOfKind,
  entryId,
  entryMargin,
  imageMargin,
  type PlaceKey,
  rootIdFor,
  type ThreadName,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { CardEvent } from "@pinetrie/rules"
import type { CardNotice } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import {
  commandNote,
  commandWords,
  historyWords,
  movedBackWords,
  newCardBox,
  noticeWords,
  pinnedMarkerWords,
  pinnedStatusWords,
  retiredWords,
  tokenSizeWords,
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
      commandWords("get-latest", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "get the latest",
    ],
    [
      "commandWords, on a WIP",
      commandWords("get-latest", {
        base: { kind: "wip", bookmark: "wip/a" },
        parent: null,
      }),
      "get the latest",
    ],
    [
      "commandWords, a WIP gone",
      commandWords("continue-on-accepted", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "continue from the latest work",
    ],
    [
      "commandNote",
      commandNote("get-latest", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "↓ gets the latest from accepted work first, then sends what you write",
    ],
    [
      "commandWords, the thread it branched from",
      commandWords("get-latest-from-parent", {
        base: { kind: "accepted" },
        parent: {
          kind: "parent",
          lane: threadIdFor("p"),
          name: "amber-fox" as ThreadName,
        },
      }),
      "get amber-fox's latest",
    ],
    [
      "commandNote, the thread it branched from, unknown",
      commandNote("get-latest-from-parent", {
        base: { kind: "accepted" },
        parent: null,
      }),
      "↓ gets the latest from the thread this one branched from first, then sends what you write",
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
      "trashed · ⌘Z brings it back",
    ],
    [
      "noticeWords, a full inventory",
      noticeWords(refusal({ code: "full" }), READER),
      "inventory full",
    ],
    [
      "noticeWords, an undo across the archive's edge",
      noticeWords(refusal({ code: "archived" }), READER),
      "not undone: restore or archive it on the board",
    ],
  ])("%s", (_, words, expected) => {
    expect(words).toBe(expected)
  })
})

describe("pinned card words", () => {
  const card = { id: textCardId("p-1"), text: "x", by: ME }
  test.each([
    ["read", pinnedStatusWords("read"), "read by the agent"],
    [
      "changed",
      pinnedStatusWords("changed"),
      "changed since the agent last read it",
    ],
    ["unread", pinnedStatusWords("unread"), "not read by the agent yet"],
    ["one token", tokenSizeWords(1), "~1 token"],
    ["tokens", tokenSizeWords(120), "~120 tokens"],
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

describe("history and traces", () => {
  const _ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const atEnd: PlaceKey = {
    kind: "note",
    column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1"),
  }
  const queued: PlaceKey = {
    kind: "queued",
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
    [event({ to: { kind: "inventory", holder: BEA } }), "put away by Bea"],
    [
      event({ kind: "undone", from: queued, to: atEnd }),
      "unqueued by Bea (an undo)",
    ],
    [
      event({ kind: "unsent", by: null, from: queued, to: atEnd }),
      "not sent: back in your message box",
    ],
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
    [{ by: BEA, verb: "put-away", traces: [trace(null)] }, "Bea put this away"],
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

test("a new card's box is drawn as its list is: a note's and a comment's as notes, a pinned card's pinned", () => {
  const thread = threadIdFor("1-r1")
  expect(
    newCardBox({
      kind: "note",
      column: cardIdOfKind(
        "note-column",
        "01a0ffd2-0000-7000-8000-0000000000c1",
      ),
    }),
  ).toMatchObject({
    tone: "note",
    placeholder: "write a note",
  })
  expect(newCardBox({ kind: "pinned", thread })).toMatchObject({
    tone: "pinned",
    placeholder: "what the agent should keep in mind on every run",
  })
  expect(
    newCardBox({
      kind: "margin",
      on: entryMargin(thread, entryId("2-a")),
      seen: "",
    }),
  ).toMatchObject({ tone: "note", placeholder: "write a comment" })
  expect(
    newCardBox({
      kind: "margin",
      on: imageMargin(
        cardIdOfKind("image", "01a0ffd2-0000-7000-8000-000000000001"),
      ),
      seen: "",
    }).title,
  ).toMatch(/^a comment on this image/)
})
