import {
  atEntry,
  type CardEvent,
  type CardHistoryRecord,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryId,
  entryId,
  keyOf,
  PLAIN,
  type PlaceKey,
  rootIdFor,
  type TraceRecord,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type Cause,
  GONE_KEEP_MS,
  HISTORY_EVENTS,
  movedBackBy,
  planGoneSweep,
  planProvenance,
  planTraceSweep,
  TRACE_MAX_AGE_MS,
  verbOf,
} from "./card-history.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE = threadIdFor("x")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const END = entryId("e-end")
const C1 = cardId("c-1")
const at = atEntry(entryId("e-1"))

const DRAFTING: CardPlace = {
  kind: "note",
  root: ROOT,
  at,
  lane: LANE,
  cell: 0,
}
const QUEUED: CardPlace = {
  kind: "queued",
  root: ROOT,
  at,
  lane: LANE,
  order: "1",
  by: ADA,
  seen: "",
}
const PINNED: CardPlace = {
  kind: "pinned",
  root: ROOT,
  at,
  lane: LANE,
  order: "1",
}
const FRESH: CardPlace = { kind: "fresh", column: "k", root: ROOT, at }
const BEAS: CardPlace = { kind: "inventory", holder: BEA }
const ADAS: CardPlace = { kind: "inventory", holder: ADA }
const ELSEWHERE: CardPlace = {
  kind: "note",
  root: ROOT,
  at: atEntry(entryId("e-2")),
  lane: null,
  cell: 0,
}

const card = (
  place: CardPlace,
  placer: WriterId = ADA,
  over: Partial<CardRecord> = {},
): CardRecord => ({
  id: C1,
  owner: ADA,
  place,
  placer,
  carries: PLAIN,
  unsent: null,
  ...over,
})

const plan = (input: {
  before: readonly CardRecord[]
  after: readonly CardRecord[]
  cause: Cause
  reading?: readonly (readonly [WriterId, EntryId])[]
  ends?: ReadonlyMap<CardId, EntryId | null>
  histories?: ReadonlyMap<CardId, CardHistoryRecord>
  traces?: readonly TraceRecord[]
}) =>
  planProvenance({
    histories: new Map(),
    traces: [],
    reading: [],
    ends: new Map([[C1, END]]),
    now: 7,
    newId: () => "t-new",
    ...input,
  })

const eventsOf = (p: ReturnType<typeof plan>) =>
  p.histories.flatMap(h => (h.kind === "set" ? h.record.events : []))
const newTraces = (p: ReturnType<typeof plan>) =>
  p.traces.flatMap(t => (t.kind === "set" ? [t.record] : []))

const BY_BEA: Cause = { kind: "move", by: BEA }

describe("planProvenance: each card's history", () => {
  test.each([
    [
      "a new card is created",
      [],
      [card(DRAFTING)],
      { kind: "move", by: ADA },
      "created",
    ],
    ["a move", [card(DRAFTING)], [card(QUEUED, BEA)], BY_BEA, "moved"],
    [
      "an undo",
      [card(QUEUED, BEA)],
      [card(DRAFTING)],
      { kind: "undo", by: BEA },
      "undone",
    ],
    [
      "a redo",
      [card(DRAFTING)],
      [card(QUEUED, BEA)],
      { kind: "redo", by: BEA },
      "redone",
    ],
    [
      "the host writes back a card it could not send",
      [card(QUEUED)],
      [card(DRAFTING, ADA, { unsent: "no" })],
      { kind: "host" },
      "unsent",
    ],
    [
      "a fresh column's first send carries its other cards",
      [card(FRESH)],
      [card(DRAFTING)],
      { kind: "host" },
      "followed",
    ],
  ] as const)("%s: the event it records", (_, before, after, cause, kind) => {
    const events = eventsOf(plan({ before, after, cause }))
    expect(events.map(e => e.kind)).toEqual([kind])
    expect(events[0]?.by).toBe(cause.kind === "host" ? null : cause.by)
  })

  test("a reorder, or a write that moves nothing, adds no event", () => {
    const reordered = card({ ...QUEUED, order: "2" })
    expect(
      eventsOf(
        plan({ before: [card(QUEUED)], after: [reordered], cause: BY_BEA }),
      ),
    ).toEqual([])
  })

  test("a card that went has its history deleted", () => {
    const histories = new Map([[C1, { card: C1, events: [] }]])
    expect(
      plan({
        before: [card(QUEUED)],
        after: [],
        cause: { kind: "host" },
        histories,
      }).histories,
    ).toEqual([{ kind: "delete", key: C1 }])
  })

  test("the cap keeps the first event and the newest", () => {
    const first: CardEvent = {
      kind: "created",
      by: ADA,
      from: null,
      to: DRAFTING,
      at: 0,
    }
    const old: CardEvent[] = [
      first,
      ...Array.from({ length: HISTORY_EVENTS - 1 }, (_, i) => ({
        ...first,
        kind: "moved" as const,
        at: i + 1,
      })),
    ]
    const events = eventsOf(
      plan({
        before: [card(DRAFTING)],
        after: [card(QUEUED, BEA)],
        cause: BY_BEA,
        histories: new Map([[C1, { card: C1, events: old }]]),
      }),
    )
    expect(events).toHaveLength(HISTORY_EVENTS)
    expect(events[0]).toEqual(first)
    expect(events.at(-1)?.at).toBe(7)
  })
})

describe("planProvenance: traces", () => {
  test("someone else moves your card while you are away: a trace for you", () => {
    expect(
      newTraces(
        plan({
          before: [card(DRAFTING)],
          after: [card(QUEUED, BEA)],
          cause: BY_BEA,
        }),
      ),
    ).toEqual([
      {
        id: "t-new",
        for: ADA,
        card: C1,
        by: BEA,
        from: { kind: "note", root: ROOT, at, lane: LANE, cell: 0 },
        to: { kind: "queued", root: ROOT, at, lane: LANE, seen: "" },
        message: null,
        at: 7,
      },
    ])
  })

  test("a send's trace carries the message it became", () => {
    const message = entryId("m-1")
    expect(
      newTraces(
        plan({
          before: [card(DRAFTING)],
          after: [],
          cause: { kind: "spend", by: BEA, message },
        }),
      ).map(t => [t.to, t.message]),
    ).toEqual([[null, message]])
  })

  test("a card whose end is unknown counts as not watched", () => {
    expect(
      newTraces(
        plan({
          before: [card(DRAFTING)],
          after: [card(QUEUED, BEA)],
          cause: BY_BEA,
          reading: [[ADA, END]],
          ends: new Map(),
        }),
      ),
    ).toHaveLength(1)
  })

  test.each([
    [
      "you were watching its end",
      card(DRAFTING),
      card(QUEUED, BEA),
      BY_BEA,
      [[ADA, END]],
    ],
    [
      "you moved it",
      card(DRAFTING),
      card(QUEUED),
      { kind: "move", by: ADA },
      [],
    ],
    ["it was unqueued", card(QUEUED), card(DRAFTING, BEA), BY_BEA, []],
    ["it was unpinned", card(PINNED), card(DRAFTING, BEA), BY_BEA, []],
    ["the host wrote it", card(QUEUED), card(DRAFTING), { kind: "host" }, []],
    ["it was a fresh column's", card(FRESH), card(BEAS, BEA), BY_BEA, []],
    ["it was in an inventory", card(ADAS), card(BEAS, BEA), BY_BEA, []],
  ] as const)("no trace when %s", (_, before, after, cause, reading) => {
    expect(
      newTraces(plan({ before: [before], after: [after], cause, reading })),
    ).toEqual([])
  })

  test("a trace whose card is back where the trace is goes", () => {
    const trace: TraceRecord = {
      id: "t-1",
      for: ADA,
      card: C1,
      by: BEA,
      from: { kind: "note", root: ROOT, at, lane: LANE, cell: 0 },
      to: { kind: "queued", root: ROOT, at, lane: LANE, seen: "" },
      message: null,
      at: 1,
    }
    expect(
      plan({
        before: [card(QUEUED, BEA)],
        after: [card(DRAFTING)],
        cause: { kind: "undo", by: BEA },
        traces: [trace],
      }).traces,
    ).toEqual([{ kind: "delete", key: "t-1" }])
  })
})

test.each([
  [null, DRAFTING, "created"],
  [DRAFTING, null, "sent"],
  [DRAFTING, QUEUED, "queued"],
  [QUEUED, DRAFTING, "unqueued"],
  [DRAFTING, PINNED, "pinned"],
  [PINNED, DRAFTING, "unpinned"],
  [QUEUED, ELSEWHERE, "moved"],
  [DRAFTING, BEAS, "took-into-inventory"],
  [BEAS, ELSEWHERE, "put"],
  [DRAFTING, ELSEWHERE, "moved"],
] as const)("verbOf(%o, %o): %s", (from, to, verb) => {
  const key = (p: CardPlace | null): PlaceKey | null =>
    p === null
      ? null
      : p.kind === "queued"
        ? { kind: "queued", root: p.root, at: p.at, lane: p.lane, seen: p.seen }
        : p.kind === "pinned"
          ? { kind: "pinned", root: p.root, at: p.at, lane: p.lane }
          : p
  expect(verbOf(key(from), key(to))).toBe(verb)
})

describe("movedBackBy", () => {
  const unqueued = (by: WriterId): CardHistoryRecord => ({
    card: C1,
    events: [
      {
        kind: "moved",
        by,
        from: { kind: "queued", root: ROOT, at, lane: LANE, seen: "" },
        to: { kind: "note", root: ROOT, at, lane: LANE, cell: 0 },
        at: 1,
      },
    ],
  })
  test("someone else's unqueue is said on the card", () => {
    expect(movedBackBy(unqueued(BEA), ADA)).toEqual({
      verb: "unqueued",
      by: BEA,
    })
  })
  test("the owner's own unqueue says nothing", () => {
    expect(movedBackBy(unqueued(ADA), ADA)).toBeNull()
  })
})

test("planTraceSweep: traces too old, and histories whose card is gone", () => {
  const trace = (id: string, when: number): TraceRecord => ({
    id,
    for: ADA,
    card: C1,
    by: BEA,
    from: { kind: "note", root: ROOT, at, lane: LANE, cell: 0 },
    to: null,
    message: null,
    at: when,
  })
  const now = TRACE_MAX_AGE_MS + 10
  const gone = cardId("c-gone")
  expect(
    planTraceSweep({
      traces: [trace("old", 1), trace("new", now)],
      histories: new Map([
        [C1, { card: C1, events: [] }],
        [gone, { card: gone, events: [] }],
      ]),
      cards: [card(DRAFTING)],
      now,
    }),
  ).toEqual({
    traces: [{ kind: "delete", key: "old" }],
    histories: [{ kind: "delete", key: gone }],
  })
})

test("planGoneSweep: a card discarded a week ago or more, or with no history to tell; never one drawn somewhere", () => {
  const discarded: CardPlace = {
    kind: "gone",
    root: ROOT,
    by: ADA,
    why: { kind: "discarded" },
  }
  const event = (when: number) => ({
    kind: "moved" as const,
    by: ADA,
    from: keyOf(DRAFTING),
    to: keyOf(discarded),
    at: when,
  })
  const now = GONE_KEEP_MS + 100
  const old = cardId("c-old")
  const fresh = cardId("c-fresh")
  const silent = cardId("c-silent")
  expect(
    planGoneSweep({
      cards: [
        { ...card(discarded), id: old },
        { ...card(discarded), id: fresh },
        { ...card(discarded), id: silent },
        card(DRAFTING),
      ],
      histories: new Map([
        [old, { card: old, events: [event(50)] }],
        [fresh, { card: fresh, events: [event(now - 10)] }],
        [C1, { card: C1, events: [event(0)] }],
      ]),
      now,
    }),
  ).toEqual([old, silent])
})
