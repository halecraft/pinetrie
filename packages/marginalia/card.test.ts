import {
  atEntry,
  type CardRecord,
  cardId,
  type EntryLike,
  entryId,
  indexTree,
  type LaneView,
  laneNameForThread,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  cardEnd,
  decodeCard,
  draftingAt,
  encodeCard,
  orderAfter,
  placeEnd,
  planCardSweep,
  planMove,
  planMoveCommand,
  planSetCommand,
  planTake,
  planUnsent,
  type QueuedCard,
  queuedOn,
  yourCard,
} from "./card.ts"

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
/** e1 -> e2, with a sibling fork e1 -> f1. */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexTree(
    Object.fromEntries(
      [entry("e1", null), entry("e2", "e1"), entry("f1", "e1"), ...more].map(
        e => [e.id, e],
      ),
    ),
  )
const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: cardId("c-1"),
  owner: ADA,
  placer: ADA,
  place: { kind: "drafting", at: atEntry(E2), lane: null },
  command: null,
  unsent: null,
  ...over,
})
const LANE = laneNameForThread("x")
const queued = (id: string, order: string, lane = LANE): QueuedCard => ({
  ...card({ id: cardId(id) }),
  place: { kind: "queued", at: atEntry(E2), lane, order, by: BEA, seen: "" },
})
const laneAt = (tip: string): LaneView[] => [
  {
    name: laneNameForThread("x"),
    tip: entryId(tip),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  },
]

describe("where a card sits", () => {
  test("placeEnd: a reply from the place, as a send would go", () => {
    // Unbound, a reply from e1 continues its newest leaf, f1.
    expect(placeEnd({ at: atEntry(E1), lane: null }, ADA, [], tree())).toBe(F1)
    // Bound to a lane, it follows the lane.
    expect(
      placeEnd(
        { at: atEntry(E1), lane: laneNameForThread("x") },
        ADA,
        laneAt("e2"),
        tree(),
      ),
    ).toBe(E2)
  })

  test("cardEnd follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"), entry("e4", "e3"))
    expect(cardEnd(card(), [], grown)).toBe("e4")
  })

  test("cardEnd: a lane card follows its lane after a conversation forks at the lane's old tip", () => {
    const lane = laneNameForThread("x")
    const onLane = card({ place: { kind: "drafting", at: atEntry(E2), lane } })
    const forked = tree(entry("e3", "e2"), entry("g1", "e2"))
    expect(cardEnd(onLane, laneAt("e3"), forked)).toBe("e3")
  })

  test("cardEnd: null for a fresh card, and for a place that is gone", () => {
    expect(
      cardEnd(card({ place: { kind: "fresh", column: "k-1" } }), [], tree()),
    ).toBeNull()
    expect(
      cardEnd(
        card({
          place: { kind: "drafting", at: atEntry(entryId("x")), lane: null },
        }),
        [],
        tree(),
      ),
    ).toBeNull()
  })

  test("draftingAt: everyone's cards at one end, oldest first, and not a sibling thread's", () => {
    const beas = card({ id: cardId("c-2"), owner: BEA })
    const sibling = card({
      id: cardId("c-3"),
      place: { kind: "drafting", at: atEntry(F1), lane: null },
    })
    expect(
      draftingAt(entryId("e2"), [card(), beas, sibling], [], tree()),
    ).toEqual([card(), beas])
  })

  test("yourCard: by thread end or fresh column, never another writer's", () => {
    const beas = card({ id: cardId("c-2"), owner: BEA })
    const fresh = card({
      id: cardId("c-3"),
      place: { kind: "fresh", column: "k-1" },
    })
    const cards = [beas, card(), fresh]
    const at = (where: Parameters<typeof yourCard>[1], me = ADA) =>
      yourCard(me, where, cards, [], tree())?.id
    expect(at({ kind: "end", end: entryId("e2") })).toBe("c-1")
    expect(at({ kind: "end", end: entryId("e2") }, BEA)).toBe("c-2")
    expect(at({ kind: "fresh", column: "k-1" })).toBe("c-3")
    expect(at({ kind: "fresh", column: "k-1" }, BEA)).toBeUndefined()
    expect(at({ kind: "end", end: entryId("f1") })).toBeUndefined()
  })

  test("yourCard: of two of yours at one end, the newest, so an unqueued one does not take the composer", () => {
    const older = card({ id: cardId("c-1") })
    const newer = card({ id: cardId("c-9") })
    expect(
      yourCard(
        ADA,
        { kind: "end", end: entryId("e2") },
        [newer, older],
        [],
        tree(),
      )?.id,
    ).toBe("c-9")
    expect(
      yourCard(
        ADA,
        { kind: "end", end: entryId("e2") },
        [older, newer],
        [],
        tree(),
      )?.id,
    ).toBe("c-9")
  })

  test("cardEnd and draftingAt see drafting cards only: a queued card is above the line", () => {
    const q = queued("c-2", "a")
    // Its lane ends at e2, where it was queued: it is still not drafting there.
    expect(cardEnd(q, laneAt("e2"), tree())).toBeNull()
    expect(
      draftingAt(entryId("e2"), [card(), q], laneAt("e2"), tree()),
    ).toEqual([card()])
  })
})

describe("the queue", () => {
  test("queuedOn: a lane's queued cards by order key, then id; not another lane's, nor drafting ones", () => {
    const other = laneNameForThread("y")
    const cards = [
      queued("c-3", "b"),
      queued("c-1", "c"),
      queued("c-2", "b"),
      queued("c-4", "a", other),
      card({ id: cardId("c-5") }),
    ]
    expect(queuedOn(cards, LANE).map(c => c.id)).toEqual(["c-2", "c-3", "c-1"])
  })

  test("orderAfter: fixed-width keys, each after every key in the queue", () => {
    const first = orderAfter([])
    const second = orderAfter([queued("c-1", first)])
    const third = orderAfter([queued("c-2", second), queued("c-1", first)])
    expect(first.length).toBe(second.length)
    expect(first < second && second < third).toBe(true)
  })

  test("planTake: nothing while the lane runs; else its top queued card", () => {
    const cards = [queued("c-2", "b"), queued("c-1", "a")]
    expect(planTake(cards, LANE, true)).toEqual({ kind: "idle" })
    expect(planTake(cards, LANE, false)).toEqual({
      kind: "take",
      card: cards[1],
    })
    expect(planTake(cards, laneNameForThread("y"), false)).toEqual({
      kind: "idle",
    })
  })

  test("planUnsent: the whole record, drafting where it was queued, saying why, its command and placer kept", () => {
    const q: QueuedCard = {
      ...queued("c-1", "a"),
      placer: BEA,
      command: "bring-up-to-date",
    }
    expect(planUnsent(q, "no such image")).toEqual({
      kind: "write",
      record: {
        ...q,
        place: { kind: "drafting", at: atEntry(E2), lane: LANE },
        unsent: "no such image",
      },
    })
  })
})

describe("handoffs (ADR-0059)", () => {
  const C1 = cardId("c-1")
  const drafting = { kind: "drafting", at: atEntry(E2), lane: LANE } as const
  const queuedKey = {
    kind: "queued",
    at: atEntry(E2),
    lane: LANE,
    seen: "",
  } as const

  test("a creation: the sender owns and placed it, with no command; refused when the id is taken", () => {
    expect(planMove([], { card: C1, from: null, to: drafting }, BEA)).toEqual({
      kind: "write",
      record: {
        id: C1,
        owner: BEA,
        placer: BEA,
        place: drafting,
        command: null,
        unsent: null,
      },
    })
    const taken = card()
    expect(
      planMove([taken], { card: C1, from: null, to: drafting }, BEA),
    ).toEqual({ kind: "refused", code: "exists", now: taken })
  })

  test("the compare: gone when there is no record, moved when it is not where the sender saw it", () => {
    expect(
      planMove([], { card: C1, from: drafting, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "gone", now: null })
    const elsewhere = card({ place: { kind: "fresh", column: "k" } })
    expect(
      planMove([elsewhere], { card: C1, from: drafting, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "moved", now: elsewhere })
  })

  test("queueing: after the lane's last card, queued and placed by the sender, why it was not sent cleared", () => {
    const before = queued("c-0", orderAfter([]))
    const c = card({
      place: drafting,
      unsent: "refused",
      command: "bring-up-to-date",
    })
    const step = planMove(
      [before, c],
      { card: C1, from: drafting, to: queuedKey },
      BEA,
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
    const q = { ...queued("c-1", "zz"), placer: ADA }
    const step = planMove([q], { card: C1, from: queuedKey, to: drafting }, BEA)
    expect(step).toEqual({
      kind: "write",
      record: { ...q, place: drafting, placer: BEA },
    })
  })

  test("an unqueue keeps the command and why it was not sent", () => {
    const q = {
      ...queued("c-1", "a"),
      command: "bring-up-to-date",
      unsent: "x",
    } as const
    const step = planMove([q], { card: C1, from: queuedKey, to: drafting }, ADA)
    expect(step.kind === "write" && step.record).toMatchObject({
      command: "bring-up-to-date",
      unsent: "x",
    })
  })

  test("a removal: only a fresh column's card", () => {
    const fresh = card({ place: { kind: "fresh", column: "k" } })
    expect(
      planMove(
        [fresh],
        { card: C1, from: { kind: "fresh", column: "k" }, to: null },
        ADA,
      ),
    ).toEqual({ kind: "remove", id: C1 })
    const c = card({ place: drafting })
    expect(planMove([c], { card: C1, from: drafting, to: null }, ADA)).toEqual({
      kind: "refused",
      code: "not-fresh",
      now: c,
    })
  })

  test("planMoveCommand: the lane to drain when the card ends queued on a lane not running", () => {
    const c = card({ place: drafting })
    const move = { card: C1, from: drafting, to: queuedKey } as const
    expect(planMoveCommand([c], move, ADA, () => false).drain).toBe(LANE)
    expect(planMoveCommand([c], move, ADA, () => true).drain).toBeNull()
    expect(
      planMoveCommand([c], { ...move, to: drafting }, ADA, () => false).drain,
    ).toBeNull()
    expect(planMoveCommand([], move, ADA, () => false).drain).toBeNull()
  })

  test("planSetCommand: sets it, the place and placer kept; gone when there is no record", () => {
    const c = card({ placer: BEA })
    expect(planSetCommand([c], C1, "bring-up-to-date")).toEqual({
      kind: "write",
      record: { ...c, command: "bring-up-to-date" },
    })
    expect(planSetCommand([], C1, null)).toEqual({
      kind: "refused",
      code: "gone",
      now: null,
    })
  })
})

test("planCardSweep: empty cards and documents with no record go; a card with text stays", () => {
  const empty = card({ id: cardId("c-2") })
  const ofDoc = (docId: string) =>
    docId.startsWith("card:") ? cardId(docId.slice(5)) : undefined
  expect(
    planCardSweep({
      cards: [card(), empty],
      texts: new Map([
        [cardId("c-1"), "keep me"],
        [cardId("c-2"), ""],
      ]),
      stored: ["card:c-1", "card:c-2", "card:gone", "note:n-1"],
      cardOfDoc: ofDoc,
    }),
  ).toEqual({ records: ["c-2"], docs: ["card:c-2", "card:gone"] })
})

test("planCardSweep: a card with a command stays, whatever its text", () => {
  const command = card({ command: "bring-up-to-date" })
  expect(
    planCardSweep({
      cards: [command],
      texts: new Map([[cardId("c-1"), ""]]),
      stored: ["card:c-1"],
      cardOfDoc: d => cardId(d.slice(5)),
    }),
  ).toEqual({ records: [], docs: [] })
})

describe("storage", () => {
  test("a record round-trips through its flat stored form", () => {
    const lane = laneNameForThread("x")
    for (const c of [
      card(),
      card({ place: { kind: "drafting", at: atEntry(E2), lane } }),
      card({ place: { kind: "fresh", column: "k-1" } }),
      queued("c-2", "k"),
      card({ command: "bring-up-to-date", unsent: "refused" }),
      card({ placer: BEA }),
    ])
      expect(
        decodeCard(c.id, JSON.parse(JSON.stringify(encodeCard(c)))),
      ).toEqual(c)
  })

  test("a malformed card is dropped, never thrown", () => {
    const ok = encodeCard(card())
    expect(decodeCard("c", { ...ok, kind: "pinned" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, at: "" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, kind: "fresh" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, owner: "" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, placer: "" })).toBeUndefined()
    const { placer: _, ...noPlacer } = ok
    expect(decodeCard("c", noPlacer)).toBeUndefined()
    expect(decodeCard("c", null)).toBeUndefined()
    expect(decodeCard("c", { ...ok, command: "pull" })).toBeUndefined()
    expect(
      decodeCard("c", {
        ...ok,
        kind: "queued",
        lane: "lane:x",
        by: "p-bea",
        seen: "",
      }),
    ).toBeUndefined()
  })

  test("a card whose lane is not a thread's keeps its text, and loses the lane", () => {
    const stored = { ...encodeCard(card()), at: "e2", lane: "main" }
    expect(decodeCard("c", stored)?.place).toEqual({
      kind: "drafting",
      at: atEntry(E2),
      lane: null,
    })
  })
})
