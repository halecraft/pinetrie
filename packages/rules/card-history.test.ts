import {
  atEntry,
  type CardEvent,
  type CardHistoryRecord,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardIdOfKind,
  type EntryId,
  entryId,
  keyOf,
  NO_CONTENT,
  type PlaceKey,
  rootIdFor,
  type TextCard,
  type TextPlace,
  type TraceRecord,
  taskIdFor,
  threadIdFor,
  type WriterId,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
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
  TRACED,
  TRACED_PLACES,
  verbOf,
} from "./card-history.ts"

const _TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE = threadIdFor("x")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const END = entryId("e-end")
const C1 = cardIdFor("c1")
const at = atEntry(entryId("e-1"))

const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
const DRAFTING: CardPlace = { kind: "note", column: NOTES, order: "1" }
const QUEUED: CardPlace = {
  kind: "queued",
  thread: LANE,
  order: "1",
  by: ADA,
  seen: "",
}
const PINNED: CardPlace = {
  kind: "pinned",
  thread: LANE,
  order: "1",
}
/** Pinned to the task the fixtures' threads are in (ADR-0116). */
const TASK_PINNED: CardPlace = {
  kind: "task-pinned",
  task: TEST_TASK,
  order: "1",
}
const FRESH: CardPlace = {
  kind: "fresh",
  column: "k",
  root: ROOT,
  task: TEST_TASK,
  at,
}
const BEAS: CardPlace = { kind: "inventory", holder: BEA }
const ADAS: CardPlace = { kind: "inventory", holder: ADA }
const ELSEWHERE: CardPlace = {
  kind: "note",
  column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a2"),
  order: "1",
}

const card = (
  place: TextPlace,
  placer: WriterId = ADA,
  over: Partial<TextCard> = {},
): TextCard => ({
  kind: "text",
  id: C1,
  owner: ADA,
  place,
  placer,
  content: { command: null, unsent: null, origin: null },
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
      [
        card(DRAFTING, ADA, {
          content: { command: null, unsent: "no", origin: null },
        }),
      ],
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

  test("a thread's card: each move between tasks and into an inventory is in its history, naming its task, and leaves no trace (ADR-0124)", () => {
    const OTHER = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
    const thread = (
      place: CardPlace & { kind: "canvas" | "inventory" },
      placer: WriterId,
    ) =>
      ({
        kind: "thread",
        id: LANE,
        owner: ADA,
        placer,
        place,
        content: NO_CONTENT,
      }) as const
    const on = (task: typeof TEST_TASK) =>
      ({ kind: "canvas", task, order: "1", width: 1 }) as const
    const moved = plan({
      before: [thread(on(TEST_TASK), ADA)],
      after: [thread(on(OTHER), BEA)],
      cause: BY_BEA,
      ends: new Map(),
    })
    expect(eventsOf(moved)).toEqual([
      {
        kind: "moved",
        by: BEA,
        from: { kind: "canvas", task: TEST_TASK },
        to: { kind: "canvas", task: OTHER },
        at: 7,
      },
    ])
    const taken = plan({
      before: [thread(on(OTHER), ADA)],
      after: [thread(BEAS as CardPlace & { kind: "inventory" }, BEA)],
      cause: BY_BEA,
      ends: new Map(),
    })
    expect(eventsOf(taken).map(e => [e.from, e.to])).toEqual([
      [{ kind: "canvas", task: OTHER }, BEAS],
    ])
    expect([newTraces(moved), newTraces(taken)]).toEqual([[], []])
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
          before: [card(PINNED)],
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
        from: { kind: "pinned", thread: LANE },
        to: { kind: "queued", thread: LANE, seen: "" },
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
          before: [card(PINNED)],
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
          before: [card(PINNED)],
          after: [card(QUEUED, BEA)],
          cause: BY_BEA,
          reading: [[ADA, END]],
          ends: new Map(),
        }),
      ),
    ).toHaveLength(1)
  })

  test("a note moved by someone else leaves no trace: a note column is everyone's scratch (ADR-0116)", () => {
    expect(
      newTraces(
        plan({
          before: [card(DRAFTING)],
          after: [card(QUEUED, BEA)],
          cause: BY_BEA,
        }),
      ),
    ).toEqual([])
    // Only a thread's queue and pinned cards are traced, each with its drawer.
    expect([...TRACED_PLACES].sort()).toEqual(["pinned", "queued"])
    // @ts-expect-error: a trace is left only where a column draws it
    const fromNote: TraceRecord["from"] = { kind: "note", column: NOTES }
    // @ts-expect-error: and a traced place has its drawer
    const noDrawer: typeof TRACED = { queued: TRACED.queued }
    expect([fromNote, noDrawer]).toHaveLength(2)
  })

  test.each([
    [
      "you were watching its end",
      card(PINNED),
      card(QUEUED, BEA),
      BY_BEA,
      [[ADA, END]],
    ],
    ["you moved it", card(PINNED), card(QUEUED), { kind: "move", by: ADA }, []],
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
      from: { kind: "queued", thread: LANE, seen: "" },
      to: { kind: "note", column: NOTES },
      message: null,
      at: 1,
    }
    expect(
      plan({
        before: [card(DRAFTING, BEA)],
        after: [card(QUEUED)],
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
  [DRAFTING, TASK_PINNED, "pinned"],
  [TASK_PINNED, DRAFTING, "unpinned"],
  [QUEUED, ADAS, "took-into-inventory"],
  [DRAFTING, BEAS, "took-into-inventory"],
  [BEAS, ELSEWHERE, "put"],
  [DRAFTING, ELSEWHERE, "moved"],
] as const)("verbOf(%o, %o): %s", (from, to, verb) => {
  const key = (p: CardPlace | null): PlaceKey | null =>
    p === null
      ? null
      : p.kind === "queued"
        ? { kind: "queued", thread: p.thread, seen: p.seen }
        : p.kind === "pinned"
          ? { kind: "pinned", thread: p.thread }
          : p.kind === "task-pinned"
            ? { kind: "task-pinned", task: p.task }
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
        from: { kind: "queued", thread: LANE, seen: "" },
        to: { kind: "note", column: NOTES },
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
    from: { kind: "queued", thread: LANE, seen: "" },
    to: null,
    message: null,
    at: when,
  })
  const now = TRACE_MAX_AGE_MS + 10
  const gone = cardIdFor("c103")
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
    task: TEST_TASK,
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
  const old = cardIdFor("c107")
  const fresh = cardIdFor("c108")
  const silent = cardIdFor("c109")
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
