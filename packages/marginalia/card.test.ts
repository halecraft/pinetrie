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
  type LaneView,
  laneNameForThread,
  type Move,
  movesDocId,
  ROOT,
  type RootId,
  type RootRecord,
  rootIdFor,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  cardEnd,
  decodeCard,
  draftingAt,
  encodeCard,
  historyOf,
  orderAfter,
  ownsPlace,
  placeEnd,
  planCardSweep,
  planFreshFollow,
  planHistorySweep,
  planMove,
  planMoveCommand,
  planMoves,
  planSetCommand,
  planTake,
  planUnsent,
  type QueuedCard,
  queuedOn,
  undoAnswer,
  yourCard,
} from "./card.ts"

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
  command: null,
  unsent: null,
  ...over,
})
const LANE = laneNameForThread("x")
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

  test("draftingAt: everyone's cards at one end, oldest first, and not a sibling thread's", () => {
    const beas = card({ id: cardId("c-2"), owner: BEA })
    const sibling = card({
      id: cardId("c-3"),
      place: { kind: "drafting", root: TEST_ROOT, at: atEntry(F1), lane: null },
    })
    expect(
      draftingAt(entryId("e2"), [card(), beas, sibling], [], tree()),
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
        command: "bring-up-to-date",
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
          { kind: "write", record: { ...inFresh(C3), command: null } },
          {
            kind: "write",
            record: { ...inFresh(C3), command: null, place: inv },
          },
        ],
      })
    })
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
      card({
        place: { kind: "drafting", root: TEST_ROOT, at: atEntry(E2), lane },
      }),
      card({ place: freshPlace("k-1") }),
      card({ place: { kind: "inventory", holder: BEA } }),
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
    expect(decodeCard("c", { ...ok, kind: "inventory" })).toBeUndefined()
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
      "a take: the root it left",
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
      "a take, its start read from the record",
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
  const archived = (
    entry: string,
    ago: number,
    state: "archived" | "restored" = "archived",
  ) =>
    [
      entryId(entry),
      { root: entryId(entry), state, by: ADA, at: NOW - ago },
    ] as const
  const archive = new Map([
    archived("e-1", 7 * DAY + 1000),
    archived("e-2", 6 * DAY),
    archived("e-3", 30 * DAY, "restored"),
  ])
  const doc = (root: RootId) => movesDocId(ADA, root)
  const stored = [R("1"), R("2"), R("3"), R("4"), R("5")].map(doc)
  const sweep = (startup: boolean) =>
    planHistorySweep({ stored, roots, archive, now: NOW, startup })

  test("a root archived 7 days and a second ago is retired; one archived 6 days ago, a restored one and one never archived are not", () => {
    expect(sweep(false)).toEqual([doc(R("1"))])
  })
  test("at startup, a root the directory does not name is retired too", () => {
    expect(sweep(true)).toEqual([doc(R("1")), doc(R("5"))])
  })
})
