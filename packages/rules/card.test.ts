import {
  atEntry,
  type CardId,
  type CardPlace,
  type CardRecord,
  DISCARDED,
  type EntryLike,
  entryId,
  INVENTORY_SLOTS,
  indexTree,
  keyOf,
  type Move,
  movesDocId,
  noteColumnIdFor,
  type OfferFact,
  PLAIN,
  ROOT,
  rootIdFor,
  type TaskId,
  type TextCard,
  type TextCardId,
  type TextPlace,
  type ThreadId,
  type TreeIndex,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { entriesOf, withThreads } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  blankQueued,
  cardEnd,
  type Discards,
  decodeCard,
  encodeCard,
  historyOf,
  isBlankMessage,
  NO_DISCARDS,
  nearestNoteColumn,
  notesOf,
  ownsPlace,
  pinnedAt,
  placeEnd,
  planCardSweep,
  planCarry,
  planFactCard,
  planFreshFollow,
  planHistorySweep,
  planMove,
  planMoveCommand,
  planMoves,
  planNextQueuedCardPop,
  planNotesTargets,
  planReorder,
  planSetCommand,
  planUnqueueAll,
  planUnsent,
  type QueuedCard,
  queuedOn,
  undoAnswer,
  yourCard,
} from "./card.ts"
import { orderAfter, orderKeys } from "./order.ts"
import { canvasOf, indexTasks, NO_TASK_INDEX, threadCardOf } from "./task.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const E1 = entryId("e1")
const E2 = entryId("e2")
const F1 = entryId("f1")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  type: "message",
  message: { role: "user", content: `text of ${id}` },
})
/**
 * e1 -> e2, with a branch e1 -> f1: thread `t-e1` is e1 and e2, thread `t-f1`
 * is f1, and each entry `more` adds that is no oldest child starts a thread
 * (`withThreads`).
 */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexTree(
    withThreads(
      entriesOf([
        entry("e1", null),
        entry("e2", "e1"),
        entry("f1", "e1"),
        ...more,
      ]),
    ),
  )
/** The thread at e1 and e2 (`withThreads`): every fixture card's, unless it says. */
const T_E = threadIdFor("e1")
/** The task every fixture card's thread is in. */
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const card = (over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: textCardId("c0000000-0000-7000-8000-000000000001"),
  owner: ADA,
  placer: ADA,
  place: { kind: "composing", at: atEntry(E2), thread: T_E },
  carries: { kind: "message", command: null },
  unsent: null,
  ...over,
})
/** The note column the fixtures' notes are in. */
const NOTES = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
/** A note in `NOTES`, as `card` is your message at e2. */
const note = (over: Partial<TextCard> = {}): TextCard =>
  card({ place: { kind: "note", column: NOTES, order: "a" }, ...over })
const LANE = threadIdFor("x")
const queuedPlace = {
  kind: "queued",
  at: atEntry(E2),
  thread: LANE,
  order: "m",
  by: ADA,
  seen: "",
} as const
const ACCEPTED: OfferFact = {
  kind: "accepted",
  lane: LANE,
  by: ADA,
  as: "kabcdefg",
  bookmark: "pinetrie-accepted",
  to: { kind: "accepted" },
}

describe("planCarry (ADR-0080)", () => {
  const queued = (carries: TextCard["carries"]) =>
    card({ place: queuedPlace, carries })
  test.each([
    [
      "a fact",
      queued({ kind: "fact", fact: ACCEPTED }),
      "",
      { kind: "fact", fact: ACCEPTED },
    ],
    [
      "a catch-up with text",
      queued({ kind: "message", command: "bring-up-to-date" }),
      "then test",
      { kind: "catch-up", command: "bring-up-to-date", after: "send" },
    ],
    [
      "a catch-up with none",
      queued({ kind: "message", command: "catch-up-with-parent" }),
      "  ",
      { kind: "catch-up", command: "catch-up-with-parent", after: "discard" },
    ],
    [
      "a split, its text the brief",
      queued({ kind: "message", command: "split" }),
      " tests apart ",
      { kind: "split", intent: "tests apart" },
    ],
    ["a message", queued(PLAIN), "hi", { kind: "send" }],
  ] as const)("%s", (_, c, text, plan) => {
    expect(planCarry(c, text)).toEqual(plan)
  })

  test("nobody moves a fact, nor sets its command", () => {
    const fact = queued({ kind: "fact", fact: ACCEPTED })
    expect(
      planMove(
        [fact],
        {
          card: fact.id,
          from: keyOf(fact.place),
          to: DISCARDED,
        },
        ADA,
        NO_DISCARDS,
      ),
    ).toEqual({ kind: "refused", code: "fact", now: fact })
    expect(planSetCommand([fact], fact.id, "bring-up-to-date")).toEqual({
      kind: "refused",
      code: "fact",
      now: fact,
    })
  })

  test("planFactCard: queued after the lane's last card, by whoever acted, with no text to wait for", () => {
    // Its id sorts after the fact's: only the order puts it first.
    const before = card({
      id: textCardId("z-9"),
      place: { ...queuedPlace, order: orderAfter([]) },
    })
    const step = planFactCard({
      cards: [before],
      id: textCardId("f-1"),
      fact: ACCEPTED,
      at: atEntry(E1),
    })
    if (step.kind !== "write") throw new Error("not a write")
    expect(step.record).toMatchObject({
      owner: ADA,
      placer: ADA,
      place: {
        kind: "queued",
        thread: LANE,
        by: ADA,
        seen: "",
        at: atEntry(E1),
      },
      carries: { kind: "fact", fact: ACCEPTED },
    })
    expect(queuedOn([before, step.record], LANE).map(c => c.id)).toEqual([
      before.id,
      "f-1",
    ])
  })

  test("the sweep keeps an empty fact card", () => {
    const fact = queued({ kind: "fact", fact: ACCEPTED })
    expect(
      planCardSweep({
        cards: [fact],
        texts: new Map(),
        stored: [],
        cardOfDoc: () => undefined,
      }).records,
    ).toEqual([])
  })
})
const freshPlace = (column: string) =>
  ({
    kind: "fresh",
    column,
    root: TEST_ROOT,
    task: TEST_TASK,
    at: ROOT,
  }) as const
const queued = (id: string, order: string, lane = LANE): QueuedCard => ({
  ...card({ id: textCardId(id) }),
  place: {
    kind: "queued",
    at: atEntry(E2),
    thread: lane,
    order,
    by: BEA,
    seen: "",
  },
})
const pinned = (
  id: string,
  order: string,
  at = E2,
): TextCard & { readonly place: Extract<CardPlace, { kind: "pinned" }> } => ({
  ...card({ id: textCardId(id) }),
  place: {
    kind: "pinned",
    at: atEntry(at),
    thread: T_E,
    order,
  },
})

describe("where a card sits", () => {
  test("placeEnd: the end of the thread its place is in", () => {
    expect(placeEnd({ at: atEntry(E1) }, tree())).toBe(E2)
    expect(placeEnd({ at: atEntry(F1) }, tree())).toBe(F1)
    expect(placeEnd({ at: ROOT }, tree())).toBeNull()
  })

  test("cardEnd follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"), entry("e4", "e3"))
    expect(cardEnd(card(), grown)).toBe("e4")
  })

  test("cardEnd: a card follows its thread past a branch at its old end", () => {
    const onLane = card({
      place: {
        kind: "composing",
        at: atEntry(E2),
        thread: threadIdFor("e1"),
      },
    })
    // e3 continues the thread; g1, newer, is a branch.
    const forked = tree(entry("e3", "e2"), entry("g1", "e2"))
    expect(cardEnd(onLane, forked)).toBe("e3")
  })

  test("cardEnd: null for a fresh card, and for a place that is gone", () => {
    expect(cardEnd(card({ place: freshPlace("k-1") }), tree())).toBeNull()
    expect(
      cardEnd(
        card({
          place: {
            kind: "composing",
            at: atEntry(entryId("x")),
            thread: T_E,
          },
        }),
        tree(),
      ),
    ).toBeNull()
  })

  test("yourCard: your message only, never a note of yours at the same end (ADR-0113)", () => {
    const yours = note({
      id: textCardId("c0000000-0000-7000-8000-000000000009"),
    })
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [card(), yours], tree())?.id,
    ).toBe("c0000000-0000-7000-8000-000000000001")
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [yours], tree()),
    ).toBeUndefined()
  })

  test("yourCard: by thread end or fresh column, never another writer's", () => {
    const beas = card({
      id: textCardId("c0000000-0000-7000-8000-000000000002"),
      owner: BEA,
    })
    const fresh = card({
      id: textCardId("c0000000-0000-7000-8000-000000000003"),
      place: freshPlace("k-1"),
    })
    const cards = [beas, card(), fresh]
    const at = (where: Parameters<typeof yourCard>[1], me = ADA) =>
      yourCard(me, where, cards, tree())?.id
    expect(at({ kind: "end", end: entryId("e2") })).toBe(
      "c0000000-0000-7000-8000-000000000001",
    )
    expect(at({ kind: "end", end: entryId("e2") }, BEA)).toBe(
      "c0000000-0000-7000-8000-000000000002",
    )
    expect(at({ kind: "fresh", column: "k-1" })).toBe(
      "c0000000-0000-7000-8000-000000000003",
    )
    expect(at({ kind: "fresh", column: "k-1" }, BEA)).toBeUndefined()
    expect(at({ kind: "end", end: entryId("f1") })).toBeUndefined()
  })

  test("yourCard: of two of yours at one end, the newest, so an unqueued one does not take the composer", () => {
    const older = card({
      id: textCardId("c0000000-0000-7000-8000-000000000001"),
    })
    const newer = card({
      id: textCardId("c0000000-0000-7000-8000-000000000009"),
    })
    expect(
      yourCard(ADA, { kind: "end", end: entryId("e2") }, [newer, older], tree())
        ?.id,
    ).toBe("c0000000-0000-7000-8000-000000000009")
    expect(
      yourCard(ADA, { kind: "end", end: entryId("e2") }, [older, newer], tree())
        ?.id,
    ).toBe("c0000000-0000-7000-8000-000000000009")
  })

  test("cardEnd sees your message alone: a queued card is above the line", () => {
    const q = queued("c0000000-0000-7000-8000-000000000002", "a")
    // Its lane ends at e2, where it was queued: it is still no message there.
    expect(cardEnd(q, tree())).toBeNull()
    expect(cardEnd(note(), tree())).toBeNull()
  })
})

describe("note columns (ADR-0116)", () => {
  const T2 = threadIdFor("two")
  const keys = orderKeys(7)
  const K = (n: number) => keys[n] ?? ""
  const thread = (t: ThreadId, order: string) => ({
    ...threadCardOf({ thread: t, task: TEST_TASK, by: ADA, cards: [] }),
    place: { kind: "canvas", task: TEST_TASK, order, width: 1 } as const,
  })
  const column = (id: string, order: string): CardRecord => ({
    kind: "note-column",
    id: noteColumnIdFor(id),
    owner: ADA,
    placer: ADA,
    place: { kind: "canvas", task: TEST_TASK, order, width: 1 },
  })
  const nearest = (cards: readonly CardRecord[], t = LANE) =>
    nearestNoteColumn(canvasOf(cards, TEST_TASK), t)
  const MADE = noteColumnIdFor("made")
  const C1 = textCardId("c0000000-0000-7000-8000-000000000001")

  test("nearestNoteColumn: the closest in the canvas's order, left or right; on a tie, the one after", () => {
    const left = column("l", K(1))
    const right = column("r", K(4))
    expect(
      nearest([left, thread(LANE, K(2)), thread(T2, K(3)), right]),
    ).toEqual({ kind: "column", column: left.id })
    expect(
      nearest([left, thread(T2, K(2)), thread(LANE, K(3)), right]),
    ).toEqual({ kind: "column", column: right.id })
    expect(nearest([left, thread(LANE, K(2)), right])).toEqual({
      kind: "column",
      column: right.id,
    })
  })

  test("nearestNoteColumn: with none, one is made just after the thread; a thread not on the canvas has none", () => {
    const made = nearest([thread(LANE, K(2)), thread(T2, K(4))])
    expect(made.kind).toBe("make")
    const order = made.kind === "make" ? made.order : null
    expect(order !== null && order > K(2) && order < K(4)).toBe(true)
    expect(nearest([thread(T2, K(2))])).toEqual({ kind: "none" })
  })

  test("notesOf: a note at the nearest column's end; the column made first where the task has none; a thread in an inventory, its inventory; a thread with no card, null", () => {
    const n1 = card({
      id: textCardId("c0000000-0000-7000-8000-000000000005"),
      place: { kind: "note", column: noteColumnIdFor("l"), order: K(5) },
    })
    const cards = [thread(LANE, K(2)), column("l", K(3)), n1]
    const there = notesOf({ cards, thread: LANE, column: MADE, by: BEA })
    expect(there?.made).toEqual([])
    expect(there?.place).toMatchObject({
      kind: "note",
      column: noteColumnIdFor("l"),
    })
    const order = there?.place.kind === "note" ? there.place.order : ""
    expect(order > K(5)).toBe(true)
    const made = notesOf({
      cards: [thread(LANE, K(2))],
      thread: LANE,
      column: MADE,
      by: BEA,
    })
    expect(made?.made).toEqual([
      {
        kind: "note-column",
        id: MADE,
        owner: BEA,
        placer: BEA,
        place: expect.objectContaining({ kind: "canvas", task: TEST_TASK }),
      },
    ])
    expect(made?.place).toMatchObject({ kind: "note", column: MADE })
    const held = {
      ...thread(LANE, K(2)),
      place: { kind: "inventory", holder: BEA } as const,
    }
    expect(
      notesOf({ cards: [held], thread: LANE, column: MADE, by: ADA })?.place,
    ).toEqual({ kind: "inventory", holder: BEA })
    expect(
      notesOf({ cards: [], thread: LANE, column: MADE, by: ADA }),
    ).toBeNull()
  })

  test("planNotesTargets: each move to a thread's notes to a column; one made for the first takes the rest", () => {
    const cards = [
      thread(LANE, K(2)),
      queued("c0000000-0000-7000-8000-000000000001", "a"),
      queued("c0000000-0000-7000-8000-000000000002", "b"),
    ]
    let n = 0
    const resolved = planNotesTargets({
      cards,
      moves: planUnqueueAll(cards, LANE),
      sender: ADA,
      newColumn: () => noteColumnIdFor(`made-${++n}`),
    })
    expect(resolved.made.map(c => c.id)).toEqual([noteColumnIdFor("made-1")])
    expect(resolved.moves.map(m => m.to)).toEqual([
      { kind: "note", column: noteColumnIdFor("made-1") },
      { kind: "note", column: noteColumnIdFor("made-1") },
    ])
  })

  test("a move to a thread's notes no one resolved is refused: no place", () => {
    expect(
      planMove(
        [note()],
        {
          card: C1,
          from: keyOf(note().place),
          to: { kind: "notes", thread: LANE },
        },
        ADA,
        NO_DISCARDS,
      ),
    ).toEqual({ kind: "refused", code: "no-place", now: note() })
  })

  test("a move into a note column lands at its end; a reorder moves a note among its column's own", () => {
    const n = (id: string, order: string, col = NOTES) =>
      card({
        id: textCardId(`c0000000-0000-7000-8000-00000000000${id}`),
        place: { kind: "note", column: col, order },
      })
    const step = planMove(
      [card(), n("2", K(1)), n("3", K(6), noteColumnIdFor("other"))],
      {
        card: C1,
        from: keyOf(card().place),
        to: { kind: "note", column: NOTES },
      },
      ADA,
      NO_DISCARDS,
    )
    const placed = step.kind === "write" ? step.record.place : null
    expect(placed?.kind === "note" && placed.order > K(1)).toBe(true)
    const notes = [n("1", K(0)), n("2", K(1)), n("3", K(2))]
    const moved = planReorder(notes, {
      card: textCardId("c0000000-0000-7000-8000-000000000003"),
      at: { kind: "note", column: NOTES },
      after: null,
      before: textCardId("c0000000-0000-7000-8000-000000000001"),
    })
    const order =
      moved.kind === "write" && moved.record.place.kind === "note"
        ? moved.record.place.order
        : ""
    expect(order < K(0)).toBe(true)
    // Not next to each other as its sender saw them: refused.
    expect(
      planReorder(notes, {
        card: textCardId("c0000000-0000-7000-8000-000000000003"),
        at: { kind: "note", column: NOTES },
        after: null,
        before: textCardId("c0000000-0000-7000-8000-000000000002"),
      }).kind,
    ).toBe("refused")
  })

  test("a note column is made by a move onto a canvas, in its task's history; never into an inventory", () => {
    const id = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000c1")
    const to = { kind: "canvas", task: TEST_TASK } as const
    expect(
      planMove([], { card: id, from: null, to }, ADA, NO_DISCARDS),
    ).toMatchObject({
      kind: "write",
      record: { kind: "note-column", id, owner: ADA, place: to },
    })
    expect(
      planMove(
        [],
        { card: id, from: null, to: { kind: "inventory", holder: ADA } },
        ADA,
        NO_DISCARDS,
      ),
    ).toEqual({ kind: "refused", code: "no-place", now: null })
    expect(historyOf([{ card: id, from: null, to }], [], NO_DISCARDS)).toBe(
      TEST_TASK,
    )
    expect(
      historyOf(
        [{ card: C1, from: null, to: { kind: "note", column: NOTES } }],
        [],
        NO_DISCARDS,
      ),
    ).toBeNull()
  })

  test("a note and a note column round-trip through their stored form; a note column held elsewhere than a canvas is malformed", () => {
    const n = note()
    expect(decodeCard(n.id, encodeCard(n))).toEqual(n)
    const col = column("01a0ffd2-0000-7000-8000-0000000000c2", K(1))
    expect(decodeCard(col.id, encodeCard(col))).toEqual(col)
    expect(
      decodeCard(col.id, {
        ...encodeCard(col),
        kind: "inventory",
        holder: ADA,
      }),
    ).toBeUndefined()
  })
})

describe("pinned cards", () => {
  test("pinnedAt: a thread's pinned cards by order, then id; not a sibling thread's, nor notes", () => {
    const cards = [
      pinned("p-3", "b"),
      pinned("p-1", "c"),
      pinned("p-2", "b"),
      pinned("p-4", "a", F1),
      card(),
    ]
    expect(pinnedAt(E2, cards, tree()).map(c => c.id)).toEqual([
      "p-2",
      "p-3",
      "p-1",
    ])
  })

  test("a pinned card follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"))
    expect(
      pinnedAt(entryId("e3"), [pinned("p-1", "a")], grown).map(c => c.id),
    ).toEqual(["p-1"])
  })

  test("cardEnd and yourCard never return a pinned card at the same end", () => {
    const mine = pinned("p-9", "a")
    expect(cardEnd(mine, tree())).toBeNull()
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [card(), mine], tree())?.id,
    ).toBe("c0000000-0000-7000-8000-000000000001")
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [mine], tree()),
    ).toBeUndefined()
  })
})

describe("the queue", () => {
  test("queuedOn: a lane's queued cards by order key, then id; not another lane's, nor notes", () => {
    const other = threadIdFor("y")
    const cards = [
      queued("c0000000-0000-7000-8000-000000000003", "b"),
      queued("c0000000-0000-7000-8000-000000000001", "c"),
      queued("c0000000-0000-7000-8000-000000000002", "b"),
      queued("c0000000-0000-7000-8000-000000000004", "a", other),
      card({ id: textCardId("c0000000-0000-7000-8000-000000000005") }),
    ]
    expect(queuedOn(cards, LANE).map(c => c.id)).toEqual([
      "c0000000-0000-7000-8000-000000000002",
      "c0000000-0000-7000-8000-000000000003",
      "c0000000-0000-7000-8000-000000000001",
    ])
  })

  test("orderAfter: fixed-width keys, each after every key in the queue", () => {
    const first = orderAfter([])
    const second = orderAfter([
      queued("c0000000-0000-7000-8000-000000000001", first),
    ])
    const third = orderAfter([
      queued("c0000000-0000-7000-8000-000000000002", second),
      queued("c0000000-0000-7000-8000-000000000001", first),
    ])
    expect(first.length).toBe(second.length)
    expect(first < second && second < third).toBe(true)
  })

  const idle = {
    running: false,
    held: false,
    typing: new Set<CardId>(),
    blank: new Set<CardId>(),
  }

  test("planNextQueuedCardPop: nothing while the lane runs; else its top queued card", () => {
    const cards = [
      queued("c0000000-0000-7000-8000-000000000002", "b"),
      queued("c0000000-0000-7000-8000-000000000001", "a"),
    ]
    expect(
      planNextQueuedCardPop(cards, LANE, { ...idle, running: true }),
    ).toEqual({ kind: "idle" })
    expect(planNextQueuedCardPop(cards, LANE, idle)).toEqual({
      kind: "pop",
      card: cards[1],
    })
    expect(planNextQueuedCardPop(cards, threadIdFor("y"), idle)).toEqual({
      kind: "idle",
    })
  })

  test("planNextQueuedCardPop: a held queue pops no message, nor a card someone types in; a fact on top goes whatever (ADR-0048 step 7)", () => {
    const top = queued("c0000000-0000-7000-8000-000000000001", "a")
    const cards = [top, queued("c0000000-0000-7000-8000-000000000002", "b")]
    expect(planNextQueuedCardPop(cards, LANE, { ...idle, held: true })).toEqual(
      { kind: "held" },
    )
    expect(
      planNextQueuedCardPop(cards, LANE, {
        ...idle,
        typing: new Set([top.id]),
      }),
    ).toEqual({ kind: "typing", card: top })
    // Typing in the second card does not hold the first.
    expect(
      planNextQueuedCardPop(cards, LANE, {
        ...idle,
        typing: new Set([textCardId("c0000000-0000-7000-8000-000000000002")]),
      }),
    ).toEqual({ kind: "pop", card: top })
    const fact: QueuedCard = {
      ...queued("c0000000-0000-7000-8000-000000000000", "0"),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    expect(
      planNextQueuedCardPop([fact, ...cards], LANE, {
        ...idle,
        held: true,
        typing: new Set([fact.id]),
      }),
    ).toEqual({ kind: "pop", card: fact })
    expect(
      planNextQueuedCardPop([fact, ...cards], LANE, {
        ...idle,
        running: true,
      }),
    ).toEqual({ kind: "idle" })
  })

  describe("planNextQueuedCardPop passes over a blank message, which stays where it is (ADR-0113)", () => {
    const empty = queued("c0000000-0000-7000-8000-000000000001", "a")
    const next = queued("c0000000-0000-7000-8000-000000000002", "b")
    const fact: QueuedCard = {
      ...queued("c0000000-0000-7000-8000-000000000003", "c"),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    test.each([
      [
        "a blank top card with a card behind: the second pops",
        [empty, next],
        idle,
        { kind: "pop", card: next },
      ],
      [
        "blank alone: it waits to be written in",
        [empty],
        idle,
        { kind: "blank", card: empty },
      ],
      [
        "blank alone, held: held",
        [empty],
        { ...idle, held: true },
        { kind: "held" },
      ],
      [
        "a fact behind a blank card pops",
        [empty, fact],
        idle,
        { kind: "pop", card: fact },
      ],
      [
        "typing in the card behind a blank one: it waits for them",
        [empty, next],
        { ...idle, typing: new Set([next.id]) },
        { kind: "typing", card: next },
      ],
    ] as const)("%s", (_, cards, facts, step) => {
      expect(
        planNextQueuedCardPop(cards, LANE, {
          ...facts,
          blank: new Set([empty.id]),
        }),
      ).toEqual(step)
    })
    test.each([
      ["whitespace", PLAIN, " \n\t", true],
      ["text", PLAIN, "go", false],
      [
        "a command with no text",
        { kind: "message", command: "split" },
        "",
        false,
      ],
      ["a fact", { kind: "fact", fact: ACCEPTED }, "", false],
    ] as const)("isBlankMessage: %s is %s", (_, carries, text, blank) => {
      expect(isBlankMessage({ ...empty, carries }, text)).toBe(blank)
    })
  })

  test("blankQueued: a queued message with no command and no text, whose text is held as its queuer had it; not one whose text has not arrived", () => {
    const empty = queued("c0000000-0000-7000-8000-000000000001", "a")
    const behind = {
      ...queued("c0000000-0000-7000-8000-000000000002", "b"),
      place: {
        ...queued("c0000000-0000-7000-8000-000000000002", "b").place,
        seen: "v-1",
      },
    }
    const command: QueuedCard = {
      ...queued("c0000000-0000-7000-8000-000000000003", "c"),
      carries: { kind: "message", command: "split" },
    }
    const blank = blankQueued([empty, behind, command, card()], {
      holds: (_, seen) => seen === "",
      text: () => " ",
    })
    expect([...blank]).toEqual([empty.id])
  })

  test("planUnqueueAll: every message card queued on the lane, to the note column nearest its thread, in order; a fact and another lane's stay", () => {
    const fact: QueuedCard = {
      ...queued("c0000000-0000-7000-8000-000000000000", "0"),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    const cards = [
      queued("c0000000-0000-7000-8000-000000000002", "b"),
      fact,
      queued("c0000000-0000-7000-8000-000000000001", "a"),
      queued("c0000000-0000-7000-8000-000000000003", "c", threadIdFor("y")),
    ]
    expect(planUnqueueAll(cards, LANE)).toEqual(
      [
        "c0000000-0000-7000-8000-000000000001",
        "c0000000-0000-7000-8000-000000000002",
      ].map(id => ({
        card: textCardId(id),
        from: {
          kind: "queued",
          at: atEntry(E2),
          thread: LANE,
          seen: "",
        },
        to: { kind: "notes", thread: LANE },
      })),
    )
  })

  test("planUnsent: the whole record, a note in the column nearest its thread, saying why, its command and placer kept", () => {
    const q: QueuedCard = {
      ...queued("c0000000-0000-7000-8000-000000000001", "a"),
      placer: BEA,
      carries: { kind: "message", command: "bring-up-to-date" },
    }
    const onCanvas = threadCardOf({
      thread: LANE,
      task: TEST_TASK,
      by: ADA,
      cards: [],
    })
    const MADE = noteColumnIdFor("made")
    const plan = planUnsent({
      cards: [onCanvas, q],
      card: q,
      reason: "no such image",
      column: MADE,
    })
    expect(plan.hold).toBe(false)
    expect(plan.steps).toEqual([
      {
        kind: "write",
        record: expect.objectContaining({ kind: "note-column", id: MADE }),
      },
      {
        kind: "write",
        record: {
          ...q,
          place: { kind: "note", column: MADE, order: expect.any(String) },
          unsent: "no such image",
        },
      },
    ])
  })

  test("planUnsent: a thread in a full inventory keeps its card queued, saying why, and holds its queue (ADR-0117)", () => {
    const q = queued("c0000000-0000-7000-8000-000000000001", "a")
    const held = {
      ...threadCardOf({ thread: LANE, task: TEST_TASK, by: BEA, cards: [] }),
      place: { kind: "inventory", holder: BEA } as const,
    }
    const full = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, n) =>
      card({
        id: textCardId(
          `c0000000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
        ),
        place: { kind: "inventory", holder: BEA },
      }),
    )
    const column = noteColumnIdFor("made")
    expect(
      planUnsent({ cards: [held, q, ...full], card: q, reason: "r", column }),
    ).toEqual({
      steps: [{ kind: "write", record: { ...q, unsent: "r" } }],
      hold: true,
    })
    expect(
      planUnsent({
        cards: [held, q, ...full.slice(1)],
        card: q,
        reason: "r",
        column,
      }).steps,
    ).toEqual([
      {
        kind: "write",
        record: {
          ...q,
          place: { kind: "inventory", holder: BEA },
          unsent: "r",
        },
      },
    ])
  })
})

describe("handoffs (ADR-0059)", () => {
  const C1 = textCardId("c0000000-0000-7000-8000-000000000001")
  const atEnd = {
    kind: "composing",
    at: atEntry(E2),
    thread: LANE,
  } as const
  const queuedKey = {
    kind: "queued",
    at: atEntry(E2),
    thread: LANE,
    seen: "",
  } as const

  test("a creation: the sender owns and placed it, with no command; refused when the id is in use", () => {
    expect(
      planMove([], { card: C1, from: null, to: atEnd }, BEA, NO_DISCARDS),
    ).toEqual({
      kind: "write",
      record: {
        kind: "text",
        id: C1,
        owner: BEA,
        placer: BEA,
        place: atEnd,
        carries: PLAIN,
        unsent: null,
      },
    })
    const taken = card()
    expect(
      planMove([taken], { card: C1, from: null, to: atEnd }, BEA, NO_DISCARDS),
    ).toEqual({ kind: "refused", code: "exists", now: taken })
  })

  test("the compare: gone when there is no record, moved when it is not where the sender saw it", () => {
    expect(
      planMove([], { card: C1, from: atEnd, to: queuedKey }, BEA, NO_DISCARDS),
    ).toEqual({ kind: "refused", code: "gone", now: null })
    const elsewhere = card({ place: freshPlace("k") })
    expect(
      planMove(
        [elsewhere],
        { card: C1, from: atEnd, to: queuedKey },
        BEA,
        NO_DISCARDS,
      ),
    ).toEqual({ kind: "refused", code: "moved", now: elsewhere })
  })

  test("queueing: after the lane's last card, queued and placed by the sender, why it was not sent cleared", () => {
    const before = queued(
      "c0000000-0000-7000-8000-000000000000",
      orderAfter([]),
    )
    const c = card({
      place: atEnd,
      unsent: "refused",
      carries: { kind: "message", command: "bring-up-to-date" },
    })
    const step = planMove(
      [before, c],
      { card: C1, from: atEnd, to: queuedKey },
      BEA,
      NO_DISCARDS,
    )
    expect(step).toEqual({
      kind: "write",
      record: {
        ...c,
        place: { ...queuedKey, order: orderAfter([before]), by: BEA },
        placer: BEA,
        unsent: null,
      },
    })
  })

  test("a reorder does not make another person's unqueue fail: the key leaves out the order", () => {
    const q = {
      ...queued("c0000000-0000-7000-8000-000000000001", "zz"),
      placer: ADA,
    }
    const step = planMove(
      [q],
      { card: C1, from: queuedKey, to: atEnd },
      BEA,
      NO_DISCARDS,
    )
    expect(step).toEqual({
      kind: "write",
      record: { ...q, place: atEnd, placer: BEA },
    })
  })

  test("a move to where the card is is refused: a card changes its place in line by a reorder", () => {
    const q = {
      ...queued("c0000000-0000-7000-8000-000000000001", "a"),
      placer: ADA,
    }
    expect(
      planMove(
        [q],
        { card: C1, from: queuedKey, to: queuedKey },
        BEA,
        NO_DISCARDS,
      ),
    ).toEqual({ kind: "refused", code: "moved", now: q })
  })

  test("an unqueue keeps the command and why it was not sent", () => {
    const q = {
      ...queued("c0000000-0000-7000-8000-000000000001", "a"),
      carries: { kind: "message", command: "bring-up-to-date" },
      unsent: "x",
    } as const
    const step = planMove(
      [q],
      { card: C1, from: queuedKey, to: atEnd },
      ADA,
      NO_DISCARDS,
    )
    expect(step.kind === "write" && step.record).toMatchObject({
      carries: { kind: "message", command: "bring-up-to-date" },
      unsent: "x",
    })
  })

  test("pinning: after every pinned card in the session, any thread's; placed by the sender, who need not own it", () => {
    const pinnedKey = {
      kind: "pinned",
      at: atEntry(E2),
      thread: LANE,
    } as const
    const elsewhere = pinned("p-1", orderAfter([]), F1)
    const c = card({ place: atEnd })
    expect(
      planMove(
        [elsewhere, c],
        { card: C1, from: atEnd, to: pinnedKey },
        BEA,
        NO_DISCARDS,
      ),
    ).toEqual({
      kind: "write",
      record: {
        ...c,
        place: { ...pinnedKey, order: orderAfter([elsewhere]) },
        placer: BEA,
      },
    })
  })

  test("unpinning goes below the line where it was pinned; a pinned card is not removed", () => {
    const p = card({
      place: {
        kind: "pinned",
        at: atEntry(E2),
        thread: LANE,
        order: "a",
      },
    })
    const from = {
      kind: "pinned",
      at: atEntry(E2),
      thread: LANE,
    } as const
    expect(
      planMove([p], { card: C1, from, to: atEnd }, BEA, NO_DISCARDS),
    ).toEqual({
      kind: "write",
      record: { ...p, place: atEnd, placer: BEA },
    })
  })

  test.each([
    {
      name: "queued to pinned",
      place: queuedPlace,
      to: { kind: "pinned", at: atEntry(E2), thread: LANE },
      lands: { order: orderAfter([]) },
    },
    {
      name: "pinned to the queue",
      place: {
        kind: "pinned",
        at: atEntry(E2),
        thread: LANE,
        order: "a",
      },
      to: queuedKey,
      lands: { order: orderAfter([]), by: BEA },
    },
  ] as const)("a card moves straight from $name (Move to ▸, ADR-0111)", ({
    place,
    to,
    lands,
  }) => {
    const c = card({ place })
    expect(
      planMove([c], { card: C1, from: keyOf(place), to }, BEA, NO_DISCARDS),
    ).toEqual({
      kind: "write",
      record: { ...c, place: { ...to, ...lands }, placer: BEA },
    })
  })

  describe("a discard (ADR-0111)", () => {
    const gone = (_: CardRecord["place"]) => DISCARDED
    // Lane `x` on TEST_TASK's canvas; the sender on another task.
    const onTask: Discards = {
      tasks: indexTasks(
        [threadCardOf({ thread: LANE, task: TEST_TASK, by: ADA, cards: [] })],
        new Map(),
      ),
      here: taskIdFor("01a0ffd2-0000-7000-8000-00000000000e"),
    }
    test.each([
      ["your message", atEnd],
      ["a fresh column's card", freshPlace("k")],
      [
        "a pinned card",
        {
          kind: "pinned",
          at: atEntry(E2),
          thread: LANE,
          order: "a",
        },
      ],
      [
        "a queued card",
        {
          kind: "queued",
          at: atEntry(E2),
          thread: LANE,
          order: "a",
          by: BEA,
          seen: "",
        },
      ],
    ] as const)("of %s: gone in the task it leaves, by its discarder", (_, place) => {
      const c = card({ place })
      expect(
        planMove(
          [c],
          { card: C1, from: keyOf(place), to: gone(place) },
          ADA,
          onTask,
        ),
      ).toEqual({
        kind: "write",
        record: {
          ...c,
          place: {
            kind: "gone",
            task: TEST_TASK,
            by: ADA,
            why: { kind: "discarded" },
          },
          placer: ADA,
        },
      })
    })

    test("a gone card is moved by no handoff, and a popped one is gone", () => {
      const discarded = card({
        place: {
          kind: "gone",
          task: TEST_TASK,
          by: ADA,
          why: { kind: "discarded" },
        },
      })
      expect(
        planMove(
          [discarded],
          { card: C1, from: keyOf(discarded.place), to: atEnd },
          ADA,
          NO_DISCARDS,
        ),
      ).toEqual({ kind: "refused", code: "gone", now: null })
      expect(
        planMove(
          [],
          { card: C1, from: atEnd, to: gone(card().place) },
          ADA,
          NO_DISCARDS,
        ),
      ).toEqual({ kind: "refused", code: "gone", now: null })
    })
  })

  describe("inventories", () => {
    const mine = { kind: "inventory", holder: ADA } as const
    const beas = { kind: "inventory", holder: BEA } as const
    const full = (holder: typeof ADA) =>
      Array.from({ length: INVENTORY_SLOTS }, (_, n) =>
        card({
          id: textCardId(`held-${n}`),
          place: { kind: "inventory", holder },
        }),
      )

    test("a take into your own inventory keeps the card's owner, command and why it was not sent", () => {
      const c = card({
        owner: BEA,
        place: atEnd,
        carries: { kind: "message", command: "bring-up-to-date" },
        unsent: "x",
      })
      expect(
        planMove([c], { card: C1, from: atEnd, to: mine }, ADA, NO_DISCARDS),
      ).toEqual({
        kind: "write",
        record: { ...c, place: mine, placer: ADA },
      })
    })

    test("into or out of someone else's inventory is refused not-yours", () => {
      const c = card({ place: atEnd })
      expect(
        planMove([c], { card: C1, from: atEnd, to: beas }, ADA, NO_DISCARDS),
      ).toEqual({
        kind: "refused",
        code: "not-yours",
        now: c,
      })
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: beas, to: atEnd }, ADA, NO_DISCARDS),
      ).toEqual({ kind: "refused", code: "not-yours", now: held })
      expect(
        planMove([], { card: C1, from: null, to: beas }, ADA, NO_DISCARDS),
      ).toEqual({
        kind: "refused",
        code: "not-yours",
        now: null,
      })
    })

    test("the nineteenth card is refused full, a creation too; another person's full inventory is not yours", () => {
      const c = card({ place: atEnd })
      expect(
        planMove(
          [...full(ADA), c],
          { card: C1, from: atEnd, to: mine },
          ADA,
          NO_DISCARDS,
        ),
      ).toEqual({ kind: "refused", code: "full", now: c })
      expect(
        planMove(
          full(ADA),
          { card: C1, from: null, to: mine },
          ADA,
          NO_DISCARDS,
        ),
      ).toEqual({ kind: "refused", code: "full", now: null })
      expect(
        planMove(
          [...full(BEA), c],
          { card: C1, from: atEnd, to: mine },
          ADA,
          NO_DISCARDS,
        ).kind,
      ).toBe("write")
      expect(
        planMove(
          full(ADA).slice(1),
          { card: C1, from: null, to: mine },
          ADA,
          NO_DISCARDS,
        ).kind,
      ).toBe("write")
    })

    test("a discard from your own inventory is gone in the task you are on, or none; from someone else's refused", () => {
      const held = card({ place: mine })
      const to = DISCARDED
      const here = { tasks: NO_TASK_INDEX, here: TEST_TASK }
      expect(
        planMove([held], { card: C1, from: mine, to }, ADA, here),
      ).toMatchObject({
        kind: "write",
        record: { place: { kind: "gone", task: TEST_TASK } },
      })
      expect(
        planMove([held], { card: C1, from: mine, to }, ADA, NO_DISCARDS),
      ).toMatchObject({
        kind: "write",
        record: { place: { kind: "gone", task: null } },
      })
      expect(planMove([held], { card: C1, from: mine, to }, BEA, here)).toEqual(
        {
          kind: "refused",
          code: "not-yours",
          now: held,
        },
      )
    })

    test("a key names its holder: Bea's inventory is not Ada's", () => {
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: mine, to: atEnd }, ADA, NO_DISCARDS),
      ).toEqual({ kind: "refused", code: "moved", now: held })
    })

    test("ownsPlace: false only for someone else's inventory", () => {
      expect(ownsPlace(mine, ADA)).toBe(true)
      expect(ownsPlace(beas, ADA)).toBe(false)
      expect(ownsPlace(atEnd, ADA)).toBe(true)
      expect(ownsPlace(queuedKey, ADA)).toBe(true)
      expect(ownsPlace(freshPlace("k"), ADA)).toBe(true)
    })
  })

  test("planFreshFollow: the sent card's column's other cards become notes in the column nearest the new thread, placer kept; nothing else moves", () => {
    const fresh = freshPlace("k")
    const sent = card({ place: fresh })
    const other = card({
      id: textCardId("c0000000-0000-7000-8000-000000000002"),
      owner: BEA,
      placer: BEA,
      place: fresh,
    })
    const elsewhere = card({
      id: textCardId("c0000000-0000-7000-8000-000000000003"),
      place: freshPlace("j"),
    })
    const onCanvas = threadCardOf({
      thread: LANE,
      task: TEST_TASK,
      by: ADA,
      cards: [],
    })
    const column = noteColumnIdFor("made")
    const follow = (
      cards: readonly CardRecord[],
      c: TextCard,
      root = TEST_ROOT,
    ) =>
      planFreshFollow({
        cards,
        sent: c.id,
        root,
        thread: LANE,
        column,
        by: ADA,
      })
    expect(follow([onCanvas, sent, other, elsewhere], sent)).toEqual([
      {
        kind: "write",
        record: expect.objectContaining({ kind: "note-column", id: column }),
      },
      {
        kind: "write",
        record: {
          ...other,
          place: { kind: "note", column, order: expect.any(String) },
        },
      },
    ])
    const draft = card({ place: atEnd })
    expect(follow([onCanvas, draft, other], draft)).toEqual([])
    // A message written in another root than the column's: nothing follows.
    const elsewhereRoot = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
    expect(follow([onCanvas, sent, other], sent, elsewhereRoot)).toEqual([])
    // A thread with no card yet: nothing follows.
    expect(follow([sent, other], sent)).toEqual([])
  })

  test("planMoveCommand: the lanes to drain where a card ends queued on a lane not running", () => {
    const c = card({ place: atEnd })
    const move = { card: C1, from: atEnd, to: queuedKey } as const
    expect(
      planMoveCommand([c], [move], ADA, () => false, NO_DISCARDS).drain,
    ).toEqual([LANE])
    expect(
      planMoveCommand([c], [move], ADA, () => true, NO_DISCARDS).drain,
    ).toEqual([])
    expect(
      planMoveCommand(
        [c],
        [{ ...move, to: atEnd }],
        ADA,
        () => false,
        NO_DISCARDS,
      ).drain,
    ).toEqual([])
    expect(
      planMoveCommand([], [move], ADA, () => false, NO_DISCARDS).drain,
    ).toEqual([])
  })

  describe("planMoves: several moves, accepted whole or refused (ADR-0066)", () => {
    const C2 = textCardId("c0000000-0000-7000-8000-000000000002")
    const C3 = textCardId("c0000000-0000-7000-8000-000000000003")
    const inv = { kind: "inventory", holder: ADA } as const
    const fresh = freshPlace("k")
    const inFresh = (id: TextCardId) => card({ id, place: fresh })

    test("two moves, the second refused: nothing written, the refusal naming its card", () => {
      const moved = card({ id: C2, place: atEnd })
      expect(
        planMoves(
          [inFresh(C1), moved],
          [
            { card: C1, from: fresh, to: inv },
            { card: C2, from: fresh, to: inv },
          ],
          ADA,
          NO_DISCARDS,
        ),
      ).toEqual({ kind: "refused", code: "moved", now: moved })
    })

    test("takes into an inventory with one free slot: full", () => {
      const held = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, n) =>
        card({ id: textCardId(`h-${n}`), place: inv }),
      )
      const step = planMoves(
        [...held, inFresh(C1), inFresh(C2)],
        [
          { card: C1, from: fresh, to: inv },
          { card: C2, from: fresh, to: inv },
        ],
        ADA,
        NO_DISCARDS,
      )
      expect(step).toMatchObject({ kind: "refused", code: "full" })
    })

    test("each move planned against the cards the earlier ones left", () => {
      // Created, then moved on: the second sees the first's card.
      const step = planMoves(
        [],
        [
          { card: C3, from: null, to: fresh },
          { card: C3, from: fresh, to: inv },
        ],
        ADA,
        NO_DISCARDS,
      )
      expect(step).toEqual({
        kind: "steps",
        steps: [
          { kind: "write", record: { ...inFresh(C3), carries: PLAIN } },
          {
            kind: "write",
            record: { ...inFresh(C3), carries: PLAIN, place: inv },
          },
        ],
      })
    })
  })

  test("planSetCommand: sets it, the place and placer kept; gone when there is no record", () => {
    const c = card({ placer: BEA })
    expect(planSetCommand([c], C1, "bring-up-to-date")).toEqual({
      kind: "write",
      record: {
        ...c,
        carries: { kind: "message", command: "bring-up-to-date" },
      },
    })
    expect(planSetCommand([], C1, null)).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
  })
})

test("planCardSweep: empty cards and documents with no record go; a card with text stays", () => {
  const empty = card({ id: textCardId("c0000000-0000-7000-8000-000000000002") })
  const ofDoc = (docId: string) =>
    docId.startsWith("card:") ? textCardId(docId.slice(5)) : undefined
  expect(
    planCardSweep({
      cards: [card(), empty],
      texts: new Map([
        [textCardId("c0000000-0000-7000-8000-000000000001"), "keep me"],
        [textCardId("c0000000-0000-7000-8000-000000000002"), ""],
      ]),
      stored: [
        "card:c0000000-0000-7000-8000-000000000001",
        "card:c0000000-0000-7000-8000-000000000002",
        "card:gone",
        "note:n-1",
      ],
      cardOfDoc: ofDoc,
    }),
  ).toEqual({
    records: ["c0000000-0000-7000-8000-000000000002"],
    docs: ["card:c0000000-0000-7000-8000-000000000002", "card:gone"],
  })
})

test("planCardSweep: a card with a command stays, whatever its text", () => {
  const command = card({
    carries: { kind: "message", command: "bring-up-to-date" },
  })
  expect(
    planCardSweep({
      cards: [command],
      texts: new Map([
        [textCardId("c0000000-0000-7000-8000-000000000001"), ""],
      ]),
      stored: ["card:c0000000-0000-7000-8000-000000000001"],
      cardOfDoc: d => textCardId(d.slice(5)),
    }),
  ).toEqual({ records: [], docs: [] })
})

describe("planReorder (ADR-0048 step 7)", () => {
  const key = (n: number) => n.toString(36).padStart(10, "0")
  const queuedAt = {
    kind: "queued",
    at: atEntry(E2),
    thread: LANE,
    seen: "",
  } as const
  const q = (id: string, n: number): QueuedCard => ({
    ...queued(id, key(n)),
    placer: ADA,
    unsent: "not sent: x",
  })
  const orderIn = (step: ReturnType<typeof planReorder>, id: string) =>
    step.kind === "write" && step.record.id === id
      ? (step.record.place as { order: string }).order
      : null

  test("up and down: only the order changes, between the neighbours its sender saw; placer, queuer, version and why kept", () => {
    const [a, b, c] = [
      q("c0000000-0000-7000-8000-00000000000a", 100),
      q("c0000000-0000-7000-8000-00000000000b", 200),
      q("c0000000-0000-7000-8000-00000000000c", 300),
    ]
    const up = planReorder([a, b, c], {
      card: c.id,
      at: queuedAt,
      after: a.id,
      before: b.id,
    })
    expect(up).toEqual({
      kind: "write",
      record: { ...c, place: { ...c.place, order: key(150) } },
    })
    const down = planReorder([a, b, c], {
      card: a.id,
      at: queuedAt,
      after: c.id,
      before: null,
    })
    const order = orderIn(down, "c0000000-0000-7000-8000-00000000000a")
    expect(order !== null && order > key(300)).toBe(true)
    const first = planReorder([a, b, c], {
      card: b.id,
      at: queuedAt,
      after: null,
      before: a.id,
    })
    const top = orderIn(first, "c0000000-0000-7000-8000-00000000000b")
    expect(top !== null && top < key(100)).toBe(true)
  })

  test("refused: gone, a fact, moved, and neighbours no longer next to each other or out of order", () => {
    const [a, b, c] = [
      q("c0000000-0000-7000-8000-00000000000a", 100),
      q("c0000000-0000-7000-8000-00000000000b", 200),
      q("c0000000-0000-7000-8000-00000000000c", 300),
    ]
    const at = queuedAt
    expect(
      planReorder([a, b], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "gone", now: null })
    const fact: QueuedCard = {
      ...q("c0000000-0000-7000-8000-00000000000f", 150),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    expect(
      planReorder([a, fact], { card: fact.id, at, after: null, before: a.id }),
    ).toMatchObject({ kind: "refused", code: "fact" })
    const drafted = card({
      id: c.id,
      place: {
        kind: "composing",
        at: atEntry(E2),
        thread: LANE,
      },
    })
    expect(
      planReorder([a, drafted], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "moved", now: drafted })
    // b sits between a and c now: the sender saw them next to each other.
    expect(
      planReorder([a, b, c, q("c0000000-0000-7000-8000-00000000000d", 400)], {
        card: "c0000000-0000-7000-8000-00000000000d" as CardId,
        at,
        after: a.id,
        before: c.id,
      }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, b, c], { card: c.id, at, after: b.id, before: a.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, c], { card: c.id, at, after: null, before: b.id }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
    expect(
      planReorder([a, c], { card: c.id, at, after: null, before: null }),
    ).toMatchObject({ kind: "refused", code: "order-changed" })
  })

  test("a queued card never passes a fact, up or down", () => {
    const [a, c] = [
      q("c0000000-0000-7000-8000-00000000000a", 100),
      q("c0000000-0000-7000-8000-00000000000c", 300),
    ]
    const fact: QueuedCard = {
      ...q("c0000000-0000-7000-8000-00000000000f", 200),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    expect(
      planReorder([a, fact, c], {
        card: c.id,
        at: queuedAt,
        after: null,
        before: a.id,
      }),
    ).toMatchObject({ kind: "refused", code: "fact" })
    expect(
      planReorder([a, fact, c], {
        card: a.id,
        at: queuedAt,
        after: c.id,
        before: null,
      }),
    ).toMatchObject({ kind: "refused", code: "fact" })
  })

  test("with no room, only the crowded siblings are written, and every card keeps its order", () => {
    const cards = [
      q("c0000000-0000-7000-8000-00000000000a", 1000),
      q("c0000000-0000-7000-8000-00000000000b", 1001),
      q("c0000000-0000-7000-8000-00000000000c", 1002),
      q("c0000000-0000-7000-8000-00000000000d", 9000),
    ]
    const step = planReorder(cards, {
      card: textCardId("c0000000-0000-7000-8000-00000000000d"),
      at: queuedAt,
      after: textCardId("c0000000-0000-7000-8000-00000000000a"),
      before: textCardId("c0000000-0000-7000-8000-00000000000b"),
    })
    expect(step.kind).toBe("steps")
    const written = step.kind === "steps" ? step.steps : []
    const now = new Map<CardId, string>(
      cards.map(c => [c.id, (c.place as { order: string }).order] as const),
    )
    for (const w of written)
      if (w.kind === "write")
        now.set(w.record.id, (w.record.place as { order: string }).order)
    const ids = [...now].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(e => e[0])
    expect(ids).toEqual([
      "c0000000-0000-7000-8000-00000000000a",
      "c0000000-0000-7000-8000-00000000000d",
      "c0000000-0000-7000-8000-00000000000b",
      "c0000000-0000-7000-8000-00000000000c",
    ])
    expect(
      written.every(w => w.kind === "write" && w.record.placer === ADA),
    ).toBe(true)
  })

  test("pinned cards: neighbours among every pinned card, other threads' between them allowed", () => {
    const pinnedAt = {
      kind: "pinned",
      at: atEntry(E2),
      thread: T_E,
    } as const
    const [a, other, b, c] = [
      pinned("p-a", key(100)),
      pinned("p-o", key(200), F1),
      pinned("p-b", key(300)),
      pinned("p-c", key(400)),
    ]
    const step = planReorder([a, other, b, c], {
      card: c.id,
      at: pinnedAt,
      after: a.id,
      before: b.id,
    })
    expect(step).toEqual({
      kind: "write",
      record: { ...c, place: { ...c.place, order: key(200) } },
    })
  })
})

describe("storage", () => {
  test("a record round-trips through its flat stored form", () => {
    const lane = threadIdFor("x")
    for (const c of [
      card(),
      card({
        place: {
          kind: "composing",
          at: atEntry(E2),
          thread: lane,
        },
      }),
      card({ place: freshPlace("k-1") }),
      card({ place: { kind: "inventory", holder: BEA } }),
      queued("c0000000-0000-7000-8000-000000000002", "k"),
      pinned("c0000000-0000-7000-8000-000000000003", "k"),
      card({
        place: {
          kind: "pinned",
          at: atEntry(E2),
          thread: lane,
          order: "m",
        },
      }),
      card({
        carries: { kind: "message", command: "bring-up-to-date" },
        unsent: "refused",
      }),
      card({ placer: BEA }),
      card({ place: queuedPlace, carries: { kind: "fact", fact: ACCEPTED } }),
    ])
      expect(
        decodeCard(c.id, JSON.parse(JSON.stringify(encodeCard(c)))),
      ).toEqual(c)
  })

  test("a malformed card is dropped, never thrown", () => {
    const ok = encodeCard(card())
    // A pinned card needs its order.
    expect(decodeCard("c", { ...ok, kind: "pinned" })).toBeUndefined()
    expect(
      decodeCard("c", {
        ...ok,
        kind: "pinned",
        at: "",
        thread: T_E,
        order: "a",
      }),
    ).toBeUndefined()
    expect(decodeCard("c", { ...ok, at: "" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, kind: "fresh" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, kind: "inventory" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, owner: "" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, placer: "" })).toBeUndefined()
    const { placer: _, ...noPlacer } = ok
    expect(decodeCard("c", noPlacer)).toBeUndefined()
    expect(decodeCard("c", null)).toBeUndefined()
    expect(decodeCard("c", { ...ok, command: "pull" })).toBeUndefined()
    // A fact this build cannot read, or a fact with a command (ADR-0080).
    expect(decodeCard("c", { ...ok, fact: "{" })).toBeUndefined()
    expect(
      decodeCard("c", {
        ...ok,
        command: "bring-up-to-date",
        fact: encodeCard(card({ carries: { kind: "fact", fact: ACCEPTED } }))
          .fact,
      }),
    ).toBeUndefined()
    expect(
      decodeCard("c", {
        ...ok,
        kind: "queued",
        thread: "lane:x",
        by: "p-bea",
        seen: "",
      }),
    ).toBeUndefined()
  })

  test("a card stored before facts is a message (ADR-0080)", () => {
    const { fact: _, ...before } = encodeCard(card())
    expect(decodeCard("c0000000-0000-7000-8000-000000000001", before)).toEqual(
      card(),
    )
  })

  test("a card at a thread's end must name its thread: one stored with no thread's id does not decode", () => {
    const stored = { ...encodeCard(card()), at: "e2", lane: "main" }
    expect(decodeCard("c", stored)).toBeUndefined()
  })

  test("a card's kind is its id's: a thread's card decodes on a canvas, a text card there does not (ADR-0116)", () => {
    const onCanvas = threadCardOf({
      thread: T_E,
      task: TEST_TASK,
      by: ADA,
      cards: [],
    })
    const stored = encodeCard(onCanvas)
    expect(decodeCard(T_E, stored)).toEqual(onCanvas)
    expect(
      decodeCard("c0000000-0000-7000-8000-000000000001", stored),
    ).toBeUndefined()
    expect(decodeCard(T_E, encodeCard(card()))).toBeUndefined()
  })
})

describe("historyOf: the task a move enters the sender's history in (ADR-0066, ADR-0116)", () => {
  const C1 = textCardId("c0000000-0000-7000-8000-000000000001")
  const T_OTHER = threadIdFor("other")
  const OTHER_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
  const inv = { kind: "inventory", holder: ADA } as const
  const draftingIn = (thread: ThreadId) =>
    ({ kind: "composing", at: atEntry(E2), thread }) as const
  const queuedIn = {
    kind: "queued",
    at: atEntry(E2),
    thread: T_E,
    seen: "",
  } as const
  // Thread `T_E` is on TEST_TASK's canvas, `T_OTHER` on OTHER_TASK's.
  const threadCard = (thread: ThreadId, task: TaskId): CardRecord =>
    threadCardOf({ thread, task, by: ADA, cards: [] })
  const tasks = indexTasks(
    [threadCard(T_E, TEST_TASK), threadCard(T_OTHER, OTHER_TASK)],
    new Map(),
  )
  const at = (place: TextPlace): CardRecord[] => [card({ place })]
  test.each<[string, Move[], CardRecord[], TaskId | null]>([
    [
      "a take into the inventory: the task it left",
      [{ card: C1, from: draftingIn(T_E), to: inv }],
      at(draftingIn(T_E)),
      TEST_TASK,
    ],
    [
      "a put: the task it went to",
      [{ card: C1, from: inv, to: draftingIn(T_OTHER) }],
      at(inv),
      OTHER_TASK,
    ],
    [
      "a drag across tasks: the task it went to",
      [{ card: C1, from: draftingIn(T_E), to: draftingIn(T_OTHER) }],
      at(draftingIn(T_E)),
      OTHER_TASK,
    ],
    [
      "a keep from a fresh column: its task",
      [{ card: C1, from: freshPlace("k"), to: inv }],
      at(freshPlace("k")),
      TEST_TASK,
    ],
    [
      "a queue: its thread's task",
      [{ card: C1, from: draftingIn(T_E), to: queuedIn }],
      at(draftingIn(T_E)),
      TEST_TASK,
    ],
    [
      "an unqueue: its thread's task",
      [{ card: C1, from: queuedIn, to: draftingIn(T_E) }],
      at({ ...queuedIn, order: "a", by: ADA }),
      TEST_TASK,
    ],
    [
      "a creation: none",
      [{ card: C1, from: null, to: draftingIn(T_E) }],
      [],
      null,
    ],
    [
      "a discard from an inventory: the task its sender is on",
      [{ card: C1, from: inv, to: DISCARDED }],
      at(inv),
      OTHER_TASK,
    ],
    [
      "a discard at a thread: the task it leaves, not its sender's",
      [{ card: C1, from: draftingIn(T_E), to: DISCARDED }],
      at(draftingIn(T_E)),
      TEST_TASK,
    ],
    [
      "between inventories: none",
      [{ card: C1, from: inv, to: inv }],
      at(inv),
      null,
    ],
    [
      "a card at a thread in no task: none",
      [{ card: C1, from: draftingIn(threadIdFor("nowhere")), to: inv }],
      at(draftingIn(threadIdFor("nowhere"))),
      null,
    ],
    // The start is the record's: the host accepts a move only from there.
    [
      "a take into the inventory, its start read from the record",
      [{ card: C1, from: inv, to: inv }],
      at(draftingIn(T_OTHER)),
      OTHER_TASK,
    ],
  ])("%s", (_, moves, cards, want) => {
    expect(historyOf(moves, cards, { tasks, here: OTHER_TASK })).toBe(want)
  })

  test("a discard from an inventory on no task: none", () => {
    const moves = [{ card: C1, from: inv, to: DISCARDED }]
    expect(historyOf(moves, at(inv), { tasks, here: null })).toBeNull()
  })
})

describe("undoAnswer (ADR-0066)", () => {
  const PLACES = "places"
  const part = (...ids: string[]) => ({
    docId: PLACES,
    footprint: ids.map(id => ["cards", id]),
  })
  const c1 = card()
  test("an undone step names each card it wrote and where it is now; a removed one has no place", () => {
    expect(
      undoAnswer(
        {
          kind: "undone",
          step: {
            parts: [
              part(
                "c0000000-0000-7000-8000-000000000001",
                "c0000000-0000-7000-8000-000000000009",
              ),
              { docId: "other", footprint: [["cards", "x"]] },
            ],
          },
        },
        [c1],
        PLACES,
      ),
    ).toEqual({
      kind: "undone",
      cards: [
        { card: c1.id, place: c1.place },
        {
          card: textCardId("c0000000-0000-7000-8000-000000000009"),
          place: null,
        },
      ],
    })
  })
  test("a refused step names the card that blocked it as it is now, and its placer; gone when it has none", () => {
    const moved = card({ placer: BEA })
    const refused = (stale: string) =>
      undoAnswer(
        {
          kind: "refused",
          step: { parts: [part("c0000000-0000-7000-8000-000000000001")] },
          stale: [part(stale)],
        },
        [moved],
        PLACES,
      )
    expect(refused("c0000000-0000-7000-8000-000000000001")).toEqual({
      kind: "refused",
      code: "moved",
      now: moved,
    })
    expect(refused("c0000000-0000-7000-8000-000000000009")).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
  })
  test("none is nothing", () => {
    expect(undoAnswer({ kind: "none" }, [c1], PLACES)).toEqual({
      kind: "nothing",
    })
  })
})

describe("planHistorySweep (ADR-0066)", () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = 100 * DAY
  const K = (n: string) => taskIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
  const tasks = new Set([K("1"), K("2"), K("3"), K("4")])
  // A restored task (K3) and one never archived (K4) are in no state of it.
  const archived = new Map(
    (
      [
        [K("1"), 7 * DAY + 1000],
        [K("2"), 6 * DAY],
      ] as const
    ).map(([task, ago]) => [task, { task, by: ADA, at: NOW - ago }] as const),
  )
  const doc = (task: TaskId) => movesDocId(ADA, task)
  const fromBefore = `moves:${ADA}:${TEST_ROOT}`
  const stored = [K("1"), K("2"), K("3"), K("4"), K("5")].map(doc)
  const sweep = (startup: boolean) =>
    planHistorySweep({
      stored: [...stored, fromBefore],
      tasks,
      archived,
      now: NOW,
      startup,
    })

  test("a task archived 7 days and a second ago is retired; one archived 6 days ago, a restored one and one never archived are not", () => {
    expect(sweep(false)).toEqual([doc(K("1"))])
  })
  test("at startup, a task the session does not hold is retired too; an id that names no task is left", () => {
    expect(sweep(true)).toEqual([doc(K("1")), doc(K("5"))])
  })
})
