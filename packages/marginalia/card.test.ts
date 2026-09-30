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
  placeEnd,
  planCardSweep,
  spends,
  yourCard,
} from "./card.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const E1 = entryId("e1")
const E2 = entryId("e2")
const F1 = entryId("f1")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id,
  parentId,
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
  ...over,
})
const laneAt = (tip: string): LaneView[] => [
  {
    name: laneNameForThread("x"),
    tip,
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
    expect(draftingAt("e2", [card(), beas, sibling], [], tree())).toEqual([
      card(),
      beas,
    ])
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
    expect(at({ kind: "end", end: "e2" })).toBe("c-1")
    expect(at({ kind: "end", end: "e2" }, BEA)).toBe("c-2")
    expect(at({ kind: "fresh", column: "k-1" })).toBe("c-3")
    expect(at({ kind: "fresh", column: "k-1" }, BEA)).toBeUndefined()
    expect(at({ kind: "end", end: "f1" })).toBeUndefined()
  })
})

test("spends: written, running or waiting spends the card; a conflict or refusal does not", () => {
  expect(
    ["appended", "started", "queued", "conflict", "refused"].map(kind =>
      spends({ kind }),
    ),
  ).toEqual([true, true, true, false, false])
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

describe("storage", () => {
  test("a record round-trips through its flat stored form", () => {
    const lane = laneNameForThread("x")
    for (const c of [
      card(),
      card({ place: { kind: "drafting", at: atEntry(E2), lane } }),
      card({ place: { kind: "fresh", column: "k-1" } }),
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
  })
})
