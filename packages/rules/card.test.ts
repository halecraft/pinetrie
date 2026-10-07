import {
  atEntry,
  type CardId,
  type CardPlace,
  type CardRecord,
  cardId,
  type EntryLike,
  entryId,
  INVENTORY_SLOTS,
  indexTree,
  keyOf,
  type LaneView,
  laneNameForThread,
  type Move,
  movesDocId,
  type OfferFact,
  PLAIN,
  ROOT,
  type RootId,
  type RootRecord,
  rootIdFor,
  type TreeIndex,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  cardEnd,
  cardsAt,
  decodeCard,
  encodeCard,
  historyOf,
  ownsPlace,
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
  planReorder,
  planSetCommand,
  planUnqueueAll,
  planUnsent,
  type QueuedCard,
  queuedOn,
  undoAnswer,
  yourCard,
} from "./card.ts"
import { orderAfter } from "./order.ts"

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
  place: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane: null },
  carries: { kind: "message", command: null },
  unsent: null,
  ...over,
})
const LANE = laneNameForThread("x")
const queuedPlace = {
  kind: "queued",
  root: TEST_ROOT,
  at: atEntry(E2),
  lane: LANE,
  order: "m",
  by: ADA,
  seen: "",
} as const
const ACCEPTED: OfferFact = {
  kind: "accepted",
  lane: LANE,
  by: ADA,
  as: "kabcdefg",
  bookmark: "pinetrie-onto",
  to: { kind: "accepted" },
}

describe("planCarry (ADR-0080)", () => {
  const queued = (carries: CardRecord["carries"]) =>
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
    ["an empty card", queued(PLAIN), " \n", { kind: "discard" }],
  ] as const)("%s", (_, c, text, plan) => {
    expect(planCarry(c, text)).toEqual(plan)
  })

  test("nobody moves a fact, nor sets its command", () => {
    const fact = queued({ kind: "fact", fact: ACCEPTED })
    expect(
      planMove(
        [fact],
        { card: fact.id, from: keyOf(fact.place), to: null },
        ADA,
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
      id: cardId("z-9"),
      place: { ...queuedPlace, order: orderAfter([]) },
    })
    const step = planFactCard({
      cards: [before],
      id: cardId("f-1"),
      fact: ACCEPTED,
      root: TEST_ROOT,
      at: atEntry(E1),
    })
    if (step.kind !== "write") throw new Error("not a write")
    expect(step.record).toMatchObject({
      owner: ADA,
      placer: ADA,
      place: { kind: "queued", lane: LANE, by: ADA, seen: "", at: atEntry(E1) },
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
  ({ kind: "fresh", column, root: TEST_ROOT, at: ROOT }) as const
const queued = (id: string, order: string, lane = LANE): QueuedCard => ({
  ...card({ id: cardId(id) }),
  place: {
    kind: "queued",
    root: TEST_ROOT,
    at: atEntry(E2),
    lane,
    order,
    by: BEA,
    seen: "",
  },
})
const pinned = (
  id: string,
  order: string,
  at = E2,
): CardRecord & { readonly place: Extract<CardPlace, { kind: "pinned" }> } => ({
  ...card({ id: cardId(id) }),
  place: {
    kind: "pinned",
    root: TEST_ROOT,
    at: atEntry(at),
    lane: null,
    order,
  },
})
const laneAt = (tip: string): LaneView[] => [
  {
    name: laneNameForThread("x"),
    tip: entryId(tip),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
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
    const onLane = card({
      place: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane },
    })
    const forked = tree(entry("e3", "e2"), entry("g1", "e2"))
    expect(cardEnd(onLane, laneAt("e3"), forked)).toBe("e3")
  })

  test("cardEnd: null for a fresh card, and for a place that is gone", () => {
    expect(cardEnd(card({ place: freshPlace("k-1") }), [], tree())).toBeNull()
    expect(
      cardEnd(
        card({
          place: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(entryId("x")),
            lane: null,
          },
        }),
        [],
        tree(),
      ),
    ).toBeNull()
  })

  test("cardsAt drafting: everyone's cards at one end, oldest first, and not a sibling thread's", () => {
    const beas = card({ id: cardId("c-2"), owner: BEA })
    const sibling = card({
      id: cardId("c-3"),
      place: { kind: "drafting", root: TEST_ROOT, at: atEntry(F1), lane: null },
    })
    expect(
      cardsAt("drafting", entryId("e2"), [card(), beas, sibling], [], tree()),
    ).toEqual([card(), beas])
  })

  test("yourCard: by thread end or fresh column, never another writer's", () => {
    const beas = card({ id: cardId("c-2"), owner: BEA })
    const fresh = card({
      id: cardId("c-3"),
      place: freshPlace("k-1"),
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

  test("cardEnd and drafting cardsAt see drafting cards only: a queued card is above the line", () => {
    const q = queued("c-2", "a")
    // Its lane ends at e2, where it was queued: it is still not drafting there.
    expect(cardEnd(q, laneAt("e2"), tree())).toBeNull()
    expect(
      cardsAt("drafting", entryId("e2"), [card(), q], laneAt("e2"), tree()),
    ).toEqual([card()])
  })
})

describe("pinned cards", () => {
  test("cardsAt pinned: a thread's pinned cards by order, then id; not a sibling thread's, nor drafting ones", () => {
    const cards = [
      pinned("p-3", "b"),
      pinned("p-1", "c"),
      pinned("p-2", "b"),
      pinned("p-4", "a", F1),
      card(),
    ]
    expect(cardsAt("pinned", E2, cards, [], tree()).map(c => c.id)).toEqual([
      "p-2",
      "p-3",
      "p-1",
    ])
  })

  test("a pinned card follows its thread as the thread grows", () => {
    const grown = tree(entry("e3", "e2"))
    expect(
      cardsAt("pinned", entryId("e3"), [pinned("p-1", "a")], [], grown).map(
        c => c.id,
      ),
    ).toEqual(["p-1"])
  })

  test("drafting cardsAt and yourCard never return a pinned card at the same end as your drafting card", () => {
    const mine = pinned("p-9", "a")
    expect(cardEnd(mine, [], tree())).toBeNull()
    expect(
      cardsAt("drafting", E2, [card(), mine], [], tree()).map(c => c.id),
    ).toEqual(["c-1"])
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [card(), mine], [], tree())?.id,
    ).toBe("c-1")
    expect(
      yourCard(ADA, { kind: "end", end: E2 }, [mine], [], tree()),
    ).toBeUndefined()
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

  const idle = { running: false, held: false, typing: new Set<CardId>() }

  test("planNextQueuedCardPop: nothing while the lane runs; else its top queued card", () => {
    const cards = [queued("c-2", "b"), queued("c-1", "a")]
    expect(
      planNextQueuedCardPop(cards, LANE, { ...idle, running: true }),
    ).toEqual({ kind: "idle" })
    expect(planNextQueuedCardPop(cards, LANE, idle)).toEqual({
      kind: "pop",
      card: cards[1],
    })
    expect(planNextQueuedCardPop(cards, laneNameForThread("y"), idle)).toEqual({
      kind: "idle",
    })
  })

  test("planNextQueuedCardPop: a held queue pops no message, nor a card someone types in; a fact on top goes whatever (ADR-0048 step 7)", () => {
    const top = queued("c-1", "a")
    const cards = [top, queued("c-2", "b")]
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
        typing: new Set([cardId("c-2")]),
      }),
    ).toEqual({ kind: "pop", card: top })
    const fact: QueuedCard = {
      ...queued("c-0", "0"),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    expect(
      planNextQueuedCardPop([fact, ...cards], LANE, {
        running: false,
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

  test("planUnqueueAll: every message card queued on the lane, back where it was queued, in order; a fact and another lane's stay", () => {
    const fact: QueuedCard = {
      ...queued("c-0", "0"),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    const cards = [
      queued("c-2", "b"),
      fact,
      queued("c-1", "a"),
      queued("c-3", "c", laneNameForThread("y")),
    ]
    expect(planUnqueueAll(cards, LANE)).toEqual(
      ["c-1", "c-2"].map(id => ({
        card: cardId(id),
        from: {
          kind: "queued",
          root: TEST_ROOT,
          at: atEntry(E2),
          lane: LANE,
          seen: "",
        },
        to: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane: LANE },
      })),
    )
  })

  test("planUnsent: the whole record, drafting where it was queued, saying why, its command and placer kept", () => {
    const q: QueuedCard = {
      ...queued("c-1", "a"),
      placer: BEA,
      carries: { kind: "message", command: "bring-up-to-date" },
    }
    expect(planUnsent(q, "no such image")).toEqual({
      kind: "write",
      record: {
        ...q,
        place: {
          kind: "drafting",
          root: TEST_ROOT,
          at: atEntry(E2),
          lane: LANE,
        },
        unsent: "no such image",
      },
    })
  })
})

describe("handoffs (ADR-0059)", () => {
  const C1 = cardId("c-1")
  const drafting = {
    kind: "drafting",
    root: TEST_ROOT,
    at: atEntry(E2),
    lane: LANE,
  } as const
  const queuedKey = {
    kind: "queued",
    root: TEST_ROOT,
    at: atEntry(E2),
    lane: LANE,
    seen: "",
  } as const

  test("a creation: the sender owns and placed it, with no command; refused when the id is in use", () => {
    expect(planMove([], { card: C1, from: null, to: drafting }, BEA)).toEqual({
      kind: "write",
      record: {
        id: C1,
        owner: BEA,
        placer: BEA,
        place: drafting,
        carries: PLAIN,
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
    const elsewhere = card({ place: freshPlace("k") })
    expect(
      planMove([elsewhere], { card: C1, from: drafting, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "moved", now: elsewhere })
  })

  test("queueing: after the lane's last card, queued and placed by the sender, why it was not sent cleared", () => {
    const before = queued("c-0", orderAfter([]))
    const c = card({
      place: drafting,
      unsent: "refused",
      carries: { kind: "message", command: "bring-up-to-date" },
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

  test("a move to where the card is is refused: a card changes its place in line by a reorder", () => {
    const q = { ...queued("c-1", "a"), placer: ADA }
    expect(
      planMove([q], { card: C1, from: queuedKey, to: queuedKey }, BEA),
    ).toEqual({ kind: "refused", code: "moved", now: q })
  })

  test("an unqueue keeps the command and why it was not sent", () => {
    const q = {
      ...queued("c-1", "a"),
      carries: { kind: "message", command: "bring-up-to-date" },
      unsent: "x",
    } as const
    const step = planMove([q], { card: C1, from: queuedKey, to: drafting }, ADA)
    expect(step.kind === "write" && step.record).toMatchObject({
      carries: { kind: "message", command: "bring-up-to-date" },
      unsent: "x",
    })
  })

  test("pinning: after every pinned card in the session, any thread's; placed by the sender, who need not own it", () => {
    const pinnedKey = {
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(E2),
      lane: LANE,
    } as const
    const elsewhere = pinned("p-1", orderAfter([]), F1)
    const c = card({ place: drafting })
    expect(
      planMove(
        [elsewhere, c],
        { card: C1, from: drafting, to: pinnedKey },
        BEA,
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
        root: TEST_ROOT,
        at: atEntry(E2),
        lane: LANE,
        order: "a",
      },
    })
    const from = {
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(E2),
      lane: LANE,
    } as const
    expect(planMove([p], { card: C1, from, to: drafting }, BEA)).toEqual({
      kind: "write",
      record: { ...p, place: drafting, placer: BEA },
    })
    expect(planMove([p], { card: C1, from, to: null }, ADA)).toEqual({
      kind: "refused",
      code: "not-fresh",
      now: p,
    })
  })

  test("a removal: a fresh column's card, not a drafting one", () => {
    const fresh = card({ place: freshPlace("k") })
    expect(
      planMove([fresh], { card: C1, from: freshPlace("k"), to: null }, ADA),
    ).toEqual({ kind: "remove", id: C1 })
    const c = card({ place: drafting })
    expect(planMove([c], { card: C1, from: drafting, to: null }, ADA)).toEqual({
      kind: "refused",
      code: "not-fresh",
      now: c,
    })
  })

  describe("inventories", () => {
    const mine = { kind: "inventory", holder: ADA } as const
    const beas = { kind: "inventory", holder: BEA } as const
    const full = (holder: typeof ADA) =>
      Array.from({ length: INVENTORY_SLOTS }, (_, n) =>
        card({
          id: cardId(`held-${n}`),
          place: { kind: "inventory", holder },
        }),
      )

    test("a take into your own inventory keeps the card's owner, command and why it was not sent", () => {
      const c = card({
        owner: BEA,
        place: drafting,
        carries: { kind: "message", command: "bring-up-to-date" },
        unsent: "x",
      })
      expect(
        planMove([c], { card: C1, from: drafting, to: mine }, ADA),
      ).toEqual({
        kind: "write",
        record: { ...c, place: mine, placer: ADA },
      })
    })

    test("into or out of someone else's inventory is refused not-yours", () => {
      const c = card({ place: drafting })
      expect(
        planMove([c], { card: C1, from: drafting, to: beas }, ADA),
      ).toEqual({ kind: "refused", code: "not-yours", now: c })
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: beas, to: drafting }, ADA),
      ).toEqual({ kind: "refused", code: "not-yours", now: held })
      expect(planMove([], { card: C1, from: null, to: beas }, ADA)).toEqual({
        kind: "refused",
        code: "not-yours",
        now: null,
      })
    })

    test("the nineteenth card is refused full, a creation too; another person's full inventory is not yours", () => {
      const c = card({ place: drafting })
      expect(
        planMove(
          [...full(ADA), c],
          { card: C1, from: drafting, to: mine },
          ADA,
        ),
      ).toEqual({ kind: "refused", code: "full", now: c })
      expect(
        planMove(full(ADA), { card: C1, from: null, to: mine }, ADA),
      ).toEqual({ kind: "refused", code: "full", now: null })
      expect(
        planMove([...full(BEA), c], { card: C1, from: drafting, to: mine }, ADA)
          .kind,
      ).toBe("write")
      expect(
        planMove(full(ADA).slice(1), { card: C1, from: null, to: mine }, ADA)
          .kind,
      ).toBe("write")
    })

    test("removal from your own inventory is allowed, from someone else's refused", () => {
      const held = card({ place: mine })
      expect(planMove([held], { card: C1, from: mine, to: null }, ADA)).toEqual(
        { kind: "remove", id: C1 },
      )
      expect(planMove([held], { card: C1, from: mine, to: null }, BEA)).toEqual(
        { kind: "refused", code: "not-yours", now: held },
      )
    })

    test("a key names its holder: Bea's inventory is not Ada's", () => {
      const held = card({ place: beas })
      expect(
        planMove([held], { card: C1, from: mine, to: drafting }, ADA),
      ).toEqual({ kind: "refused", code: "moved", now: held })
    })

    test("ownsPlace: false only for someone else's inventory", () => {
      expect(ownsPlace(mine, ADA)).toBe(true)
      expect(ownsPlace(beas, ADA)).toBe(false)
      expect(ownsPlace(drafting, ADA)).toBe(true)
      expect(ownsPlace(queuedKey, ADA)).toBe(true)
      expect(ownsPlace(freshPlace("k"), ADA)).toBe(true)
    })
  })

  test("planFreshFollow: the sent card's column's other cards go drafting at the new entry, placer kept; nothing else moves", () => {
    const fresh = freshPlace("k")
    const sent = card({ place: fresh })
    const other = card({
      id: cardId("c-2"),
      owner: BEA,
      placer: BEA,
      place: fresh,
    })
    const elsewhere = card({
      id: cardId("c-3"),
      place: freshPlace("j"),
    })
    expect(
      planFreshFollow([sent, other, elsewhere], sent.id, TEST_ROOT, E2, LANE),
    ).toEqual([
      {
        kind: "write",
        record: {
          ...other,
          place: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(E2),
            lane: LANE,
          },
        },
      },
    ])
    const draft = card({ place: drafting })
    expect(
      planFreshFollow([draft, other], draft.id, TEST_ROOT, E2, LANE),
    ).toEqual([])
    // A message written in another root than the column's: nothing follows.
    const elsewhereRoot = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
    expect(
      planFreshFollow([sent, other], sent.id, elsewhereRoot, E2, LANE),
    ).toEqual([])
  })

  test("planMoveCommand: the lanes to drain where a card ends queued on a lane not running", () => {
    const c = card({ place: drafting })
    const move = { card: C1, from: drafting, to: queuedKey } as const
    expect(planMoveCommand([c], [move], ADA, () => false).drain).toEqual([LANE])
    expect(planMoveCommand([c], [move], ADA, () => true).drain).toEqual([])
    expect(
      planMoveCommand([c], [{ ...move, to: drafting }], ADA, () => false).drain,
    ).toEqual([])
    expect(planMoveCommand([], [move], ADA, () => false).drain).toEqual([])
  })

  describe("planMoves: several moves, accepted whole or refused (ADR-0066)", () => {
    const C2 = cardId("c-2")
    const C3 = cardId("c-3")
    const inv = { kind: "inventory", holder: ADA } as const
    const fresh = freshPlace("k")
    const inFresh = (id: CardId) => card({ id, place: fresh })

    test("two moves, the second refused: nothing written, the refusal naming its card", () => {
      const moved = card({ id: C2, place: drafting })
      expect(
        planMoves(
          [inFresh(C1), moved],
          [
            { card: C1, from: fresh, to: inv },
            { card: C2, from: fresh, to: inv },
          ],
          ADA,
        ),
      ).toEqual({ kind: "refused", code: "moved", now: moved })
    })

    test("takes into an inventory with one free slot: full", () => {
      const held = Array.from({ length: INVENTORY_SLOTS - 1 }, (_, n) =>
        card({ id: cardId(`h-${n}`), place: inv }),
      )
      const step = planMoves(
        [...held, inFresh(C1), inFresh(C2)],
        [
          { card: C1, from: fresh, to: inv },
          { card: C2, from: fresh, to: inv },
        ],
        ADA,
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
  const command = card({
    carries: { kind: "message", command: "bring-up-to-date" },
  })
  expect(
    planCardSweep({
      cards: [command],
      texts: new Map([[cardId("c-1"), ""]]),
      stored: ["card:c-1"],
      cardOfDoc: d => cardId(d.slice(5)),
    }),
  ).toEqual({ records: [], docs: [] })
})

describe("planReorder (ADR-0048 step 7)", () => {
  const key = (n: number) => n.toString(36).padStart(10, "0")
  const queuedAt = {
    kind: "queued",
    root: TEST_ROOT,
    at: atEntry(E2),
    lane: LANE,
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
    const [a, b, c] = [q("c-a", 100), q("c-b", 200), q("c-c", 300)]
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
    const order = orderIn(down, "c-a")
    expect(order !== null && order > key(300)).toBe(true)
    const first = planReorder([a, b, c], {
      card: b.id,
      at: queuedAt,
      after: null,
      before: a.id,
    })
    const top = orderIn(first, "c-b")
    expect(top !== null && top < key(100)).toBe(true)
  })

  test("refused: gone, a fact, moved, and neighbours no longer next to each other or out of order", () => {
    const [a, b, c] = [q("c-a", 100), q("c-b", 200), q("c-c", 300)]
    const at = queuedAt
    expect(
      planReorder([a, b], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "gone", now: null })
    const fact: QueuedCard = {
      ...q("c-f", 150),
      carries: { kind: "fact", fact: ACCEPTED },
    }
    expect(
      planReorder([a, fact], { card: fact.id, at, after: null, before: a.id }),
    ).toMatchObject({ kind: "refused", code: "fact" })
    const drafted = card({
      id: c.id,
      place: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane: LANE },
    })
    expect(
      planReorder([a, drafted], { card: c.id, at, after: null, before: a.id }),
    ).toEqual({ kind: "refused", code: "moved", now: drafted })
    // b sits between a and c now: the sender saw them next to each other.
    expect(
      planReorder([a, b, c, q("c-d", 400)], {
        card: "c-d" as CardId,
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
    const [a, c] = [q("c-a", 100), q("c-c", 300)]
    const fact: QueuedCard = {
      ...q("c-f", 200),
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
      q("c-a", 1000),
      q("c-b", 1001),
      q("c-c", 1002),
      q("c-d", 9000),
    ]
    const step = planReorder(cards, {
      card: cardId("c-d"),
      at: queuedAt,
      after: cardId("c-a"),
      before: cardId("c-b"),
    })
    expect(step.kind).toBe("steps")
    const written = step.kind === "steps" ? step.steps : []
    const now = new Map(
      cards.map(c => [c.id, (c.place as { order: string }).order] as const),
    )
    for (const w of written)
      if (w.kind === "write")
        now.set(w.record.id, (w.record.place as { order: string }).order)
    const ids = [...now].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(e => e[0])
    expect(ids).toEqual(["c-a", "c-d", "c-b", "c-c"])
    expect(
      written.every(w => w.kind === "write" && w.record.placer === ADA),
    ).toBe(true)
  })

  test("pinned cards: neighbours among every pinned card, other threads' between them allowed", () => {
    const pinnedAt = {
      kind: "pinned",
      root: TEST_ROOT,
      at: atEntry(E2),
      lane: null,
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
    const lane = laneNameForThread("x")
    for (const c of [
      card(),
      card({
        place: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane },
      }),
      card({ place: freshPlace("k-1") }),
      card({ place: { kind: "inventory", holder: BEA } }),
      queued("c-2", "k"),
      pinned("c-3", "k"),
      card({
        place: {
          kind: "pinned",
          root: TEST_ROOT,
          at: atEntry(E2),
          lane,
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
      decodeCard("c", { ...ok, kind: "pinned", at: "", order: "a" }),
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
        lane: "lane:x",
        by: "p-bea",
        seen: "",
      }),
    ).toBeUndefined()
  })

  test("a card stored before facts is a message (ADR-0080)", () => {
    const { fact: _, ...before } = encodeCard(card())
    expect(decodeCard("c-1", before)).toEqual(card())
  })

  test("a card whose lane is not a thread's keeps its text, and loses the lane", () => {
    const stored = { ...encodeCard(card()), at: "e2", lane: "main" }
    expect(decodeCard("c", stored)?.place).toEqual({
      kind: "drafting",
      root: TEST_ROOT,
      at: atEntry(E2),
      lane: null,
    })
  })
})

describe("historyOf: the root a move enters the sender's history in (ADR-0066)", () => {
  const OTHER = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
  const C1 = cardId("c-1")
  const inv = { kind: "inventory", holder: ADA } as const
  const draftingIn = (root: RootId) =>
    ({ kind: "drafting", root, at: atEntry(E2), lane: null }) as const
  const queuedIn = {
    kind: "queued",
    root: TEST_ROOT,
    at: atEntry(E2),
    lane: LANE,
    seen: "",
  } as const
  const at = (place: CardPlace): CardRecord[] => [card({ place })]
  test.each<[string, Move[], CardRecord[], RootId | null]>([
    [
      "a take into the inventory: the root it left",
      [{ card: C1, from: draftingIn(TEST_ROOT), to: inv }],
      at(draftingIn(TEST_ROOT)),
      TEST_ROOT,
    ],
    [
      "a put: the root it went to",
      [{ card: C1, from: inv, to: draftingIn(OTHER) }],
      at(inv),
      OTHER,
    ],
    [
      "a drag across roots: the root it went to",
      [{ card: C1, from: draftingIn(TEST_ROOT), to: draftingIn(OTHER) }],
      at(draftingIn(TEST_ROOT)),
      OTHER,
    ],
    [
      "a keep from a fresh column: its root",
      [{ card: C1, from: freshPlace("k"), to: inv }],
      at(freshPlace("k")),
      TEST_ROOT,
    ],
    [
      "a queue: its root",
      [{ card: C1, from: draftingIn(TEST_ROOT), to: queuedIn }],
      at(draftingIn(TEST_ROOT)),
      TEST_ROOT,
    ],
    [
      "an unqueue: its root",
      [{ card: C1, from: queuedIn, to: draftingIn(TEST_ROOT) }],
      at({ ...queuedIn, order: "a", by: ADA }),
      TEST_ROOT,
    ],
    [
      "a creation: none",
      [{ card: C1, from: null, to: draftingIn(TEST_ROOT) }],
      [],
      null,
    ],
    [
      "a removal: none",
      [{ card: C1, from: freshPlace("k"), to: null }],
      at(freshPlace("k")),
      null,
    ],
    [
      "between inventories: none",
      [{ card: C1, from: inv, to: inv }],
      at(inv),
      null,
    ],
    // The start is the record's: the host accepts a move only from there.
    [
      "a take into the inventory, its start read from the record",
      [{ card: C1, from: inv, to: inv }],
      at(draftingIn(OTHER)),
      OTHER,
    ],
  ])("%s", (_, moves, cards, want) => {
    expect(historyOf(moves, cards)).toBe(want)
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
              part("c-1", "c-9"),
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
        { card: cardId("c-9"), place: null },
      ],
    })
  })
  test("a refused step names the card that blocked it as it is now, and its placer; gone when it has none", () => {
    const moved = card({ placer: BEA })
    const refused = (stale: string) =>
      undoAnswer(
        {
          kind: "refused",
          step: { parts: [part("c-1")] },
          stale: [part(stale)],
        },
        [moved],
        PLACES,
      )
    expect(refused("c-1")).toEqual({
      kind: "refused",
      code: "moved",
      now: moved,
    })
    expect(refused("c-9")).toEqual({ kind: "refused", code: "gone", now: null })
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
  const rootAt = (root: RootId, entry: string): [RootId, RootRecord] => [
    root,
    {
      root,
      entry: entryId(entry),
      first: null,
      firstLine: "",
      title: null,
      messages: 0,
      newest: null,
      writers: [],
      threads: {},
      mentions: [],
      images: [],
    },
  ]
  const R = (n: string) => rootIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`)
  const roots = new Map([
    rootAt(R("1"), "e-1"),
    rootAt(R("2"), "e-2"),
    rootAt(R("3"), "e-3"),
    rootAt(R("4"), "e-4"),
  ])
  // A restored root (R3) and one never archived (R4) are in no state of it.
  const archived = new Map(
    (
      [
        [R("1"), 7 * DAY + 1000],
        [R("2"), 6 * DAY],
      ] as const
    ).map(([root, ago]) => [root, { root, by: ADA, at: NOW - ago }] as const),
  )
  const doc = (root: RootId) => movesDocId(ADA, root)
  const stored = [R("1"), R("2"), R("3"), R("4"), R("5")].map(doc)
  const sweep = (startup: boolean) =>
    planHistorySweep({ stored, roots, archived, now: NOW, startup })

  test("a root archived 7 days and a second ago is retired; one archived 6 days ago, a restored one and one never archived are not", () => {
    expect(sweep(false)).toEqual([doc(R("1"))])
  })
  test("at startup, a root the directory does not name is retired too", () => {
    expect(sweep(true)).toEqual([doc(R("1")), doc(R("5"))])
  })
})
