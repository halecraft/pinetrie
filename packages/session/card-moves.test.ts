import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type ActedAt,
  answerOf,
  intentsOf,
  type LocalState,
  localStep,
  type MovesEvent,
  type MovesState,
  movesStep,
  NO_MOVES,
  type Pending,
  pendingOf,
  slotOnAccept,
  stampSeen,
  withPending,
} from "./card-moves.ts"
import { TEST_ROOT } from "./fixtures.ts"

const ME = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = laneNameForThread("x")
const C1 = cardId("c-1")
const at = atEntry(entryId("e-1"))
const drafting = { kind: "drafting", root: TEST_ROOT, at, lane: LANE } as const
const queuedKey = {
  kind: "queued",
  root: TEST_ROOT,
  at,
  lane: LANE,
  seen: "",
} as const

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: C1,
  owner: ME,
  placer: ME,
  place: drafting,
  carries: { kind: "message", command: null },
  unsent: null,
  ...over,
})

const COLUMN: ActedAt = { kind: "column", key: "k-1" }
const OTHER_COLUMN: ActedAt = { kind: "column", key: "k-2" }
const sentAs = {
  answer: { state: "sent" },
  slot: null,
  actedAt: COLUMN,
} as const

const run = (events: readonly MovesEvent[], from = NO_MOVES): MovesState =>
  events.reduce(movesStep, from)

const queueIt: Pending = {
  ...sentAs,
  id: "m-1",
  kind: "move",
  move: { card: C1, from: drafting, to: queuedKey },
}
const sent = (...p: Pending[]): MovesEvent => ({ kind: "sent", pending: p })
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
    const out = run([sent({ ...sentAs, id: "m-1", kind: "send", card: C1 })])
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

  test("overtaken: accepted, then the queued card's pop removes it before the copy catches up; nothing stays drawn", () => {
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
    expect(s.notices).toEqual([refusal])
  })

  test("an accepted discard is kept as a notice where you made it, until your next move there; drawn gone until then", () => {
    const gone = {
      kind: "gone",
      root: TEST_ROOT,
      why: { kind: "discarded" },
    } as const
    const discard = {
      ...sentAs,
      id: "d-1",
      kind: "move",
      move: { card: C1, from: drafting, to: gone },
    } as const
    const s = run([sent(discard), accepted("d-1", 4)])
    expect(s.notices).toEqual([
      { card: C1, actedAt: COLUMN, code: "discarded" },
    ])
    expect(withPending(host, s, ME)[0]?.place).toEqual({ ...gone, by: ME })
    expect(movesStep(s, sent(queueIt)).notices).toEqual([])
  })

  test("a later move where you acted forgets the notices there, not elsewhere", () => {
    const refusal = (actedAt: ActedAt) =>
      ({ card: C1, actedAt, code: "gone", by: null, fromQueue: true }) as const
    const s: MovesState = {
      ...NO_MOVES,
      notices: [
        refusal(COLUMN),
        refusal(OTHER_COLUMN),
        refusal({ kind: "inventory" }),
      ],
    }
    expect(movesStep(s, sent(queueIt)).notices).toEqual([
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

  test("a reorder is drawn where the host would put it, its queuer kept, until the copy reaches its rev (ADR-0048 step 7)", () => {
    const key = (n: number) => n.toString(36).padStart(10, "0")
    const q = (id: string, n: number) =>
      card({
        id: cardId(id),
        place: { ...queuedKey, order: key(n), by: BEA },
        placer: BEA,
      })
    const records = [q("c-a", 100), q("c-b", 200), q("c-c", 300)]
    const reorder = {
      card: cardId("c-c"),
      at: queuedKey,
      after: cardId("c-a"),
      before: cardId("c-b"),
    }
    const s = run([
      sent({ ...sentAs, id: "r-1", kind: "reorder", reorder }),
      accepted("r-1", 4),
    ])
    const drawn = withPending(records, s, ME).find(c => c.id === "c-c")
    expect(drawn?.place).toEqual({ ...queuedKey, order: key(150), by: BEA })
    expect(drawn?.placer).toBe(BEA)
    expect(withPending(records, movesStep(s, changed(4)), ME)).toBe(records)
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

  test("an unqueue the pop beat: gone, naming who queued it", () => {
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

describe("a command of several moves: a keep (ADR-0066)", () => {
  const C2 = cardId("c-2")
  const inventory = { kind: "inventory", holder: ME } as const
  const keeping = (card: typeof C1, slot: number): Pending => ({
    ...sentAs,
    id: "k-1",
    kind: "move",
    move: { card, from: drafting, to: inventory },
    slot,
  })
  const both = [keeping(C1, 3), keeping(C2, 4)]
  const records = [card(), card({ id: C2 })]

  test("every move drawn at once, and every one accepted by the one answer", () => {
    const s = run([sent(...both)])
    expect(withPending(records, s, ME).map(c => c.place.kind)).toEqual([
      "inventory",
      "inventory",
    ])
    const answered = run([accepted("k-1", 7)], s)
    expect(answered.pending.map(p => p.answer)).toEqual([
      { state: "accepted", rev: 7 },
      { state: "accepted", rev: 7 },
    ])
    expect(run([changed(7)], answered).pending).toEqual([])
  })

  test("refused whole: none drawn", () => {
    const s = run([
      sent(...both),
      {
        kind: "answered",
        id: "k-1",
        answer: { kind: "refused", refusal: null },
      },
    ])
    expect(s.pending).toEqual([])
  })
})

describe("acted with no host to ask", () => {
  test("a swap forgets the notices at the inventory, not elsewhere", () => {
    const atInventory = {
      card: null,
      actedAt: { kind: "inventory" },
      code: "slots-changed",
    } as const
    const inColumn = {
      card: C1,
      actedAt: COLUMN,
      code: "gone",
      by: null,
      fromQueue: false,
    } as const
    const s = run([
      { kind: "refused", refusal: atInventory },
      { kind: "refused", refusal: inColumn },
      { kind: "acted", at: { kind: "inventory" } },
    ])
    expect(s.notices).toEqual([inColumn])
  })
})

describe("intentsOf", () => {
  test("each take into the inventory in flight's slot, a creation's too, until its copy holds it", () => {
    const intoInventory: Pending = {
      ...sentAs,
      id: "m-1",
      kind: "move",
      move: { card: C1, from: drafting, to: { kind: "inventory", holder: ME } },
      slot: 3,
    }
    const create: Pending = {
      ...sentAs,
      id: "m-2",
      kind: "create",
      draft: card({ id: cardId("c-2") }),
      slot: 7,
    }
    const s = run([
      sent(intoInventory),
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

describe("a move's decisions, before and after it is sent", () => {
  const inventory = { kind: "inventory", holder: ME } as const
  const intoInventory = pendingOf(
    "m-1",
    { card: C1, from: drafting, to: inventory },
    { actedAt: { kind: "inventory" }, slot: 4 },
    null,
  )

  test("an accepted take into the inventory writes its slot; refused, or with no slot, nothing", () => {
    const yes = { kind: "accepted", rev: 2 } as const
    expect(slotOnAccept(intoInventory, yes)).toEqual({ card: C1, slot: 4 })
    expect(
      slotOnAccept(intoInventory, { kind: "refused", refusal: null }),
    ).toBeNull()
    expect(slotOnAccept({ ...intoInventory, slot: null }, yes)).toBeNull()
    expect(slotOnAccept(queueIt, yes)).toBeNull()
  })

  test("a queue carries the text's version as sent; any other move is left alone", () => {
    const move = { card: C1, from: drafting, to: queuedKey }
    expect(stampSeen(move, "v9").to).toEqual({ ...queuedKey, seen: "v9" })
    const out = { card: C1, from: drafting, to: drafting }
    expect(stampSeen(out, "v9")).toBe(out)
  })
})

describe("records, moves and cards, in one step", () => {
  const host = [card()]
  const start: LocalState = { records: host, moves: NO_MOVES, cards: host }

  test("new records move the rev and the drawn cards together", () => {
    const sentState = localStep(start, sent(queueIt), ME)
    expect(placeOf(sentState.cards)).toBe("queued")
    const queued = [card({ place: { ...queuedKey, order: "a", by: ME } })]
    const after = localStep(
      localStep(sentState, accepted("m-1", 3), ME),
      { kind: "records", records: queued, rev: 3 },
      ME,
    )
    expect(after.moves.rev).toBe(3)
    expect(after.moves.pending).toEqual([])
    expect(after.cards).toBe(queued)
  })

  test("a step that changes nothing gives the same state", () => {
    expect(localStep(start, { kind: "hostLeft" }, ME)).toBe(start)
    expect(
      localStep(start, { kind: "records", records: host, rev: 0 }, ME),
    ).toBe(start)
  })
})
