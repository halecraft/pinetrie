import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type ActedAt,
  answerOf,
  type HistoryEntry,
  intentsOf,
  type MovesEvent,
  type MovesState,
  movesStep,
  NO_MOVES,
  type Pending,
  withPending,
} from "./card-moves.ts"

const ME = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = laneNameForThread("x")
const C1 = cardId("c-1")
const at = atEntry(entryId("e-1"))
const drafting = { kind: "drafting", at, lane: LANE } as const
const queuedKey = { kind: "queued", at, lane: LANE, seen: "" } as const

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: C1,
  owner: ME,
  placer: ME,
  place: drafting,
  command: null,
  unsent: null,
  ...over,
})

const COLUMN: ActedAt = { kind: "column", key: "k-1" }
const OTHER_COLUMN: ActedAt = { kind: "column", key: "k-2" }
const sentAs = {
  answer: { state: "sent" },
  slot: null,
  actedAt: COLUMN,
  history: { kind: "none" },
} as const

const run = (events: readonly MovesEvent[], from = NO_MOVES): MovesState =>
  events.reduce(movesStep, from)

const queueIt: Pending = {
  ...sentAs,
  id: "m-1",
  kind: "move",
  move: { card: C1, from: drafting, to: queuedKey },
}
const sent = (p: Pending): MovesEvent => ({ kind: "sent", pending: p })
const accepted = (id: string, rev: number): MovesEvent => ({
  kind: "answered",
  id,
  answer: { kind: "accepted", rev },
})
const changed = (rev: number): MovesEvent => ({ kind: "changed", rev })
const placeOf = (records: readonly CardRecord[]) => records[0]?.place.kind

describe("the tab's moves (ADR-0059)", () => {
  const host = [card()]

  test("sent: a creation, a move and a move out are drawn at once", () => {
    const draft = card({ id: cardId("c-2") })
    const s = run([
      sent({ ...sentAs, id: "m-0", kind: "create", draft }),
      sent(queueIt),
    ])
    const drawn = withPending(host, s, ME)
    expect(drawn.map(c => [c.id, c.place.kind])).toEqual([
      ["c-1", "queued"],
      ["c-2", "drafting"],
    ])
    const out = run([
      sent({
        ...sentAs,
        id: "m-1",
        kind: "move",
        move: { card: C1, from: drafting, to: null },
      }),
    ])
    expect(withPending(host, out, ME)).toEqual([])
  })

  test("accepted, the answer before the places: drawn until the copy reaches its rev", () => {
    const s = run([sent(queueIt), accepted("m-1", 4)])
    expect(placeOf(withPending(host, s, ME))).toBe("queued")
    expect(placeOf(withPending(host, movesStep(s, changed(3)), ME))).toBe(
      "queued",
    )
    const caught = movesStep(s, changed(4))
    expect(caught.pending).toEqual([])
    expect(withPending(host, caught, ME)).toBe(host)
  })

  test("accepted, the places before the answer: dropped at the answer", () => {
    const s = run([sent(queueIt), changed(4), accepted("m-1", 4)])
    expect(s.pending).toEqual([])
  })

  test("overtaken: accepted, then the take removes the card before the copy catches up; nothing stays drawn", () => {
    const s = run([sent(queueIt), accepted("m-1", 4)])
    // The copy goes from drafting straight to gone, at rev 5.
    const after = movesStep(s, changed(5))
    expect(after.pending).toEqual([])
    expect(withPending([], after, ME)).toEqual([])
  })

  test("refused: dropped at once, the host's record drawn, and the refusal kept", () => {
    const refusal = {
      card: C1,
      actedAt: COLUMN,
      code: "moved",
      by: BEA,
      fromQueue: false,
    } as const
    const s = run([
      sent(queueIt),
      { kind: "answered", id: "m-1", answer: { kind: "refused", refusal } },
    ])
    expect(withPending(host, s, ME)).toBe(host)
    expect(s.refusals).toEqual([refusal])
  })

  test("a later move where you acted forgets the refusals there, not elsewhere", () => {
    const refusal = (actedAt: ActedAt) =>
      ({ card: C1, actedAt, code: "gone", by: null, fromQueue: true }) as const
    const s: MovesState = {
      ...NO_MOVES,
      refusals: [
        refusal(COLUMN),
        refusal(OTHER_COLUMN),
        refusal({ kind: "inventory" }),
      ],
    }
    expect(movesStep(s, sent(queueIt)).refusals).toEqual([
      refusal(OTHER_COLUMN),
      refusal({ kind: "inventory" }),
    ])
  })

  test("a queued card drawn before the host orders it is last in its lane, queued by you", () => {
    const s = run([sent(queueIt)])
    expect(withPending(host, s, ME)[0]?.place).toEqual({
      ...queuedKey,
      order: "\uffff",
      by: ME,
    })
  })

  test("the host left: nothing stays drawn", () => {
    const s = run([sent(queueIt), { kind: "hostLeft" }])
    expect(s.pending).toEqual([])
  })
})

describe("answerOf", () => {
  const context = { card: C1, actedAt: COLUMN, queuedBy: null }

  test("a send: written, running or queued is accepted at the reply's rev; busy and the rest are dropped unworded", () => {
    for (const outcome of [
      { kind: "appended", id: entryId("e-2") },
      { kind: "queued" },
      { kind: "moved" },
    ] as const)
      expect(answerOf(outcome, 6, context)).toEqual({
        kind: "accepted",
        rev: 6,
      })
    for (const outcome of [
      { kind: "busy" },
      { kind: "conflict", by: null },
      { kind: "failed", message: "x" },
    ] as const)
      expect(answerOf(outcome, null, context)).toEqual({
        kind: "refused",
        refusal: null,
      })
  })

  test("an unqueue the take beat: gone, naming who queued it", () => {
    expect(
      answerOf({ kind: "unmoved", code: "gone", place: null, by: null }, 3, {
        ...context,
        queuedBy: BEA,
      }),
    ).toEqual({
      kind: "refused",
      refusal: {
        card: C1,
        actedAt: COLUMN,
        code: "gone",
        by: BEA,
        fromQueue: true,
      },
    })
  })

  test("a move someone made first: moved, naming its placer", () => {
    expect(
      answerOf(
        { kind: "unmoved", code: "moved", place: drafting, by: BEA },
        3,
        context,
      ),
    ).toEqual({
      kind: "refused",
      refusal: {
        card: C1,
        actedAt: COLUMN,
        code: "moved",
        by: BEA,
        fromQueue: false,
      },
    })
  })
})

describe("the tab's history of moves (ADR-0052)", () => {
  const take: HistoryEntry = {
    kind: "handoff",
    move: { card: C1, from: drafting, to: { kind: "inventory", holder: ME } },
    slot: 3,
    column: null,
  }
  const swap: HistoryEntry = { kind: "swap", a: 0, b: 1, cards: [C1, null] }
  const moving = (
    id: string,
    history: Pending["history"],
    slot: number | null = null,
  ): Pending => ({
    ...sentAs,
    id,
    kind: "move",
    move: take.move,
    slot,
    history,
  })
  const refused = (id: string): MovesEvent => ({
    kind: "answered",
    id,
    answer: { kind: "refused", refusal: null },
  })

  test("an accepted move is recorded with its slot; a refused one is not; a send never is", () => {
    const s = run([
      sent(moving("m-1", { kind: "record", entry: take }, 3)),
      accepted("m-1", 2),
      sent(moving("m-2", { kind: "record", entry: swap })),
      refused("m-2"),
      sent(moving("m-3", { kind: "none" })),
      accepted("m-3", 3),
    ])
    expect(s.history).toEqual({ undo: [take], redo: [] })
  })

  test("an undo leaves its list when sent, goes to redo when accepted; a new move clears redo", () => {
    const recorded = run([
      sent(moving("m-1", { kind: "record", entry: take })),
      accepted("m-1", 2),
    ])
    const undoing = movesStep(
      recorded,
      sent(moving("m-2", { kind: "undo", entry: take })),
    )
    expect(undoing.history).toEqual({ undo: [], redo: [] })
    const undone = movesStep(undoing, accepted("m-2", 3))
    expect(undone.history).toEqual({ undo: [], redo: [take] })
    const redone = run(
      [sent(moving("m-3", { kind: "redo", entry: take })), accepted("m-3", 4)],
      undone,
    )
    expect(redone.history).toEqual({ undo: [take], redo: [] })
    const cleared = run(
      [
        sent(moving("m-4", { kind: "undo", entry: take })),
        accepted("m-4", 5),
        sent(moving("m-5", { kind: "record", entry: swap })),
        accepted("m-5", 6),
      ],
      redone,
    )
    expect(cleared.history).toEqual({ undo: [swap], redo: [] })
  })

  test("a refused undo is dropped, and so is an entry undo could not act on", () => {
    const recorded = run([
      sent(moving("m-1", { kind: "record", entry: take })),
      accepted("m-1", 2),
    ])
    const s = run(
      [sent(moving("m-2", { kind: "undo", entry: take })), refused("m-2")],
      recorded,
    )
    expect(s.history).toEqual({ undo: [], redo: [] })
    const refusal = {
      card: null,
      actedAt: { kind: "inventory" },
      code: "slots-changed",
    } as const
    const swapped = movesStep(NO_MOVES, {
      kind: "swapped",
      step: { kind: "record", entry: swap },
    })
    expect(swapped.history.undo).toEqual([swap])
    const dropped = movesStep(swapped, {
      kind: "dropped",
      entry: swap,
      refusal,
    })
    expect(dropped.history.undo).toEqual([])
    expect(dropped.refusals).toEqual([refusal])
  })

  test("intentsOf: each take in flight's slot, a creation's too, until its copy holds it", () => {
    const create: Pending = {
      ...sentAs,
      id: "m-2",
      kind: "create",
      draft: card({ id: cardId("c-2") }),
      slot: 7,
    }
    const s = run([
      sent(moving("m-1", { kind: "none" }, 3)),
      sent(create),
      sent({ ...queueIt, id: "m-9" }),
    ])
    expect(intentsOf(s)).toEqual(
      new Map([
        [C1, 3],
        [cardId("c-2"), 7],
      ]),
    )
    expect(intentsOf(run([accepted("m-1", 5), changed(5)], s))).toEqual(
      new Map([[cardId("c-2"), 7]]),
    )
  })
})
