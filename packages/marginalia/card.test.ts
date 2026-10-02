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
  planTake,
  planUnsent,
  type QueuedCard,
  queuedOn,
  queueFields,
  unqueueFields,
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

  test("queueFields writes the queued place and clears unsent; unqueueFields writes only the kind", () => {
    expect(
      queueFields({
        at: atEntry(E2),
        lane: LANE,
        by: BEA,
        order: "k",
        seen: "v",
      }),
    ).toEqual({
      kind: "queued",
      at: "e2",
      lane: LANE,
      order: "k",
      by: BEA,
      seen: "v",
      unsent: "",
    })
    expect(unqueueFields()).toEqual({ kind: "drafting" })
  })

  test("an unqueued card is drafting where it was queued", () => {
    const q = queued("c-1", "a")
    const stored = { ...encodeCard(q), ...unqueueFields() }
    expect(decodeCard("c-1", stored)?.place).toEqual({
      kind: "drafting",
      at: atEntry(E2),
      lane: LANE,
    })
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

  test("planUnsent: the whole record, drafting where it was queued, saying why, its command kept", () => {
    const q: QueuedCard = { ...queued("c-1", "a"), command: "bring-up-to-date" }
    const stored = planUnsent(q, "no such image")
    expect(stored.kind).toBe("drafting")
    expect(decodeCard("c-1", stored)).toEqual({
      ...q,
      place: { kind: "drafting", at: atEntry(E2), lane: LANE },
      unsent: "no such image",
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
    ])
      expect(
        decodeCard(c.id, JSON.parse(JSON.stringify(encodeCard(c)))),
      ).toEqual(c)
  })

  test("a malformed card is dropped, never thrown", () => {
    const ok = {
      owner: "p-ada",
      kind: "drafting",
      at: "e2",
      lane: "",
      column: "",
    }
    expect(decodeCard("c", { ...ok, kind: "pinned" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, at: "" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, kind: "fresh" })).toBeUndefined()
    expect(decodeCard("c", { ...ok, owner: "" })).toBeUndefined()
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

  test("a card stored before commands and queues reads with neither", () => {
    expect(
      decodeCard("c", {
        owner: "p-ada",
        kind: "drafting",
        at: "e2",
        lane: "",
        column: "",
      }),
    ).toMatchObject({ command: null, unsent: null })
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
