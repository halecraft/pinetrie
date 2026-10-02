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
  answerOf,
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
const OTHER = laneNameForThread("y")
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

const run = (events: readonly MovesEvent[], from = NO_MOVES): MovesState =>
  events.reduce(movesStep, from)

const queueIt: Pending = {
  id: "m-1",
  kind: "move",
  move: { card: C1, from: drafting, to: queuedKey },
  answer: { state: "sent" },
}
const sent = (p: Pending, lane = LANE): MovesEvent => ({
  kind: "sent",
  pending: p,
  lane,
})
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
      sent({ id: "m-0", kind: "create", draft, answer: { state: "sent" } }),
      sent(queueIt),
    ])
    const drawn = withPending(host, s, ME)
    expect(drawn.map(c => [c.id, c.place.kind])).toEqual([
      ["c-1", "queued"],
      ["c-2", "drafting"],
    ])
    const out = run([sent({ ...queueIt, move: { ...queueIt.move, to: null } })])
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
      lane: LANE,
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

  test("a later move in a lane forgets that lane's refusals, not another lane's", () => {
    const refusal = (lane: typeof LANE) =>
      ({ card: C1, lane, code: "gone", by: null, fromQueue: true }) as const
    const s: MovesState = {
      ...NO_MOVES,
      refusals: [refusal(LANE), refusal(OTHER)],
    }
    expect(movesStep(s, sent(queueIt)).refusals).toEqual([refusal(OTHER)])
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
  const context = { card: C1, lane: LANE, queuedBy: null }

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
      refusal: { card: C1, lane: LANE, code: "gone", by: BEA, fromQueue: true },
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
        lane: LANE,
        code: "moved",
        by: BEA,
        fromQueue: false,
      },
    })
  })
})
