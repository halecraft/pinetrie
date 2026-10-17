import {
  atEntry,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  NO_CONTENT,
  type TextCard,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  type ActedAt,
  drawnPlace,
  type LocalState,
  localStep,
  type MovesEvent,
  type MovesState,
  moveAnswer,
  movesStep,
  NO_MOVES,
  type Pending,
  pendingMove,
  queuedDraft,
  slotIntents,
  slotOnAccept,
  stampSeen,
  withPending,
} from "./card-moves.ts"

const _TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const ME = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = threadIdFor("x")
const C1 = cardIdFor("c1")
const _at = atEntry(entryId("e-1"))
const atEnd = { kind: "composing", thread: LANE } as const
const queuedKey = {
  kind: "queued",
  thread: LANE,
  seen: "",
} as const

const card = (over: Partial<TextCard> = {}): TextCard => ({
  kind: "text",
  id: C1,
  owner: ME,
  placer: ME,
  place: atEnd,
  content: { command: null, unsent: null, origin: null },
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
  move: { card: C1, from: atEnd, to: queuedKey },
}
const sent = (...p: Pending[]): MovesEvent => ({ kind: "sent", pending: p })
const accepted = (id: string, rev: number): MovesEvent => ({
  kind: "answered",
  id,
  answer: { kind: "accepted", rev },
})
const changed = (rev: number): MovesEvent => ({ kind: "changed", rev })
const placeOf = (records: readonly CardRecord[]) => records[0]?.place.kind

describe("the tab's moves", () => {
  const host = [card()]

  test("sent: a creation, a move and a move out are drawn at once", () => {
    const draft = card({
      id: cardIdFor("c2"),
    })
    const s = run([
      sent({ ...sentAs, id: "m-0", kind: "create", draft }),
      sent(queueIt),
    ])
    const drawn = withPending(host, s, ME)
    expect(drawn.map(c => [c.id, c.place.kind])).toEqual([
      [cardIdFor("c1"), "queued"],
      [cardIdFor("c2"), "composing"],
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

  test("overtaken: an accepted move whose card the pop removes leaves nothing drawn", () => {
    const s = run([sent(queueIt), accepted("m-1", 4)])
    // The copy goes from atEnd straight to gone, at rev 5.
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

  test("an accepted discard is a notice where you made it until your next move there, drawn gone until then", () => {
    const gone = { kind: "trash", why: { kind: "discarded" } } as const
    const discard = {
      ...sentAs,
      id: "d-1",
      kind: "move",
      move: { card: C1, from: atEnd, to: gone },
    } as const
    const s = run([sent(discard), accepted("d-1", 4)])
    expect(s.notices).toEqual([
      { card: C1, actedAt: COLUMN, code: "discarded" },
    ])
    // In no history until the host names one.
    expect(withPending(host, s, ME)[0]?.place).toEqual({
      kind: "trash",
      left: host[0]?.place,
    })
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

  test("a card made in the queue is drawn there at once, with its command, and nowhere else", () => {
    const made = { card: C1, from: null, to: queuedKey } as const
    const draft = queuedDraft(made, ME, "split")
    expect(draft).toEqual({
      kind: "text" as const,
      id: C1,
      owner: ME,
      placer: ME,
      place: { ...queuedKey, order: "\uffff", by: ME },
      content: { command: "split", unsent: null, origin: null },
    })
    const s = run([
      sent(pendingMove("m-2", made, { actedAt: COLUMN, slot: null }, draft)),
    ])
    expect(withPending([], s, ME).map(c => c.place.kind)).toEqual(["queued"])
    expect(queuedDraft(queueIt.move, ME, "split")).toBeNull()
  })

  test("a reorder is drawn where the host would put it, its queuer kept, until the copy reaches its rev", () => {
    const key = (n: number) => n.toString(36).padStart(10, "0")
    const q = (id: string, n: number) =>
      card({
        id: textCardId(id),
        place: { ...queuedKey, order: key(n), by: BEA },
        placer: BEA,
      })
    const records = [
      q(cardIdFor("ca"), 100),
      q(cardIdFor("cb"), 200),
      q(cardIdFor("cc"), 300),
    ]
    const reorder = {
      card: cardIdFor("cc"),
      at: queuedKey,
      after: cardIdFor("ca"),
      before: cardIdFor("cb"),
    }
    const s = run([
      sent({ ...sentAs, id: "r-1", kind: "reorder", reorder }),
      accepted("r-1", 4),
    ])
    const drawn = withPending(records, s, ME).find(
      c => c.id === cardIdFor("cc"),
    )
    expect(drawn?.place).toEqual({ ...queuedKey, order: key(150), by: BEA })
    expect(drawn?.placer).toBe(BEA)
    expect(withPending(records, movesStep(s, changed(4)), ME)).toBe(records)
  })

  test("the host left: nothing stays drawn", () => {
    const s = run([sent(queueIt), { kind: "hostLeft" }])
    expect(s.pending).toEqual([])
  })
})

describe("moveAnswer", () => {
  const context = { card: C1, actedAt: COLUMN, queuedBy: null }

  test("a send: written, running or queued is accepted at the reply's rev; the rest dropped unworded", () => {
    for (const outcome of [
      { kind: "appended", id: entryId("e-2") },
      { kind: "queued" },
      { kind: "moved" },
    ] as const)
      expect(moveAnswer(outcome, 6, context)).toEqual({
        kind: "accepted",
        rev: 6,
      })
    for (const outcome of [
      { kind: "busy" },
      { kind: "conflict", by: null },
      { kind: "failed", message: "x" },
    ] as const)
      expect(moveAnswer(outcome, null, context)).toEqual({
        kind: "refused",
        refusal: null,
      })
  })

  test("an unqueue the pop beat: gone, naming who queued it", () => {
    expect(
      moveAnswer({ kind: "unmoved", code: "gone", place: null, by: null }, 3, {
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
      moveAnswer(
        { kind: "unmoved", code: "moved", place: atEnd, by: BEA },
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

describe("a command of several moves: a keep", () => {
  const C2 = cardIdFor("c2")
  const inventory = { kind: "inventory", holder: ME } as const
  const keeping = (card: typeof C1, slot: number): Pending => ({
    ...sentAs,
    id: "k-1",
    kind: "move",
    move: { card, from: atEnd, to: inventory },
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

describe("slotIntents", () => {
  test("each take into the inventory in flight's slot, a creation's too, until its copy holds it", () => {
    const intoInventory: Pending = {
      ...sentAs,
      id: "m-1",
      kind: "move",
      move: { card: C1, from: atEnd, to: { kind: "inventory", holder: ME } },
      slot: 3,
    }
    const create: Pending = {
      ...sentAs,
      id: "m-2",
      kind: "create",
      draft: card({ id: cardIdFor("c2") }),
      slot: 7,
    }
    const s = run([
      sent(intoInventory),
      sent(create),
      sent({ ...queueIt, id: "m-9" }),
    ])
    expect(slotIntents(s)).toEqual(
      new Map([
        [C1, 3],
        [cardIdFor("c2"), 7],
      ]),
    )
    expect(slotIntents(run([accepted("m-1", 5), changed(5)], s))).toEqual(
      new Map([[cardIdFor("c2"), 7]]),
    )
  })
})

describe("a move's decisions, before and after it is sent", () => {
  const inventory = { kind: "inventory", holder: ME } as const
  const intoInventory = pendingMove(
    "m-1",
    { card: C1, from: atEnd, to: inventory },
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

  test("a queue carries the text's version as sent", () => {
    const move = { card: C1, from: atEnd, to: queuedKey }
    expect(stampSeen(move, "v9").to).toEqual({ ...queuedKey, seen: "v9" })
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

describe("drawnPlace", () => {
  const canvas = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
  const thread: CardRecord = {
    kind: "thread",
    id: LANE,
    owner: ME,
    placer: ME,
    place: { kind: "canvas", canvas, order: "0000000100", width: 1 },
    content: NO_CONTENT,
  }
  const column = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a1",
  )
  const notes: CardRecord = {
    kind: "note-column",
    id: column,
    owner: ME,
    placer: ME,
    place: { kind: "canvas", canvas, order: "0000000200", width: 1 },
    content: NO_CONTENT,
  }
  test("a thread's nearest notes are drawn in the column the host would choose, or nowhere yet", () => {
    const to = { kind: "notes", near: "thread", thread: LANE } as const
    expect(drawnPlace(to, ME, [thread, notes])).toEqual({
      kind: "note",
      column,
      order: expect.any(String),
    })
    expect(drawnPlace(to, ME, [thread])).toBeUndefined()
    expect(drawnPlace(to, ME, [])).toBeUndefined()
  })
  test("a spot on a canvas is drawn at the rank the host would give it, between its neighbours", () => {
    const drawn = drawnPlace({ kind: "canvas-at", canvas, after: LANE }, ME, [
      thread,
      notes,
    ])
    const order = drawn?.kind === "canvas" ? drawn.order : ""
    expect(order > "0000000100" && order < "0000000200").toBe(true)
  })
})
