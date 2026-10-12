import { describe, expect, test } from "vitest"
import {
  type CardKind,
  cardIdOfKind,
  type FactCardId,
  fitsPlace,
  isTargetOf,
  KINDS,
  kindOfCard,
  makeCard,
  NO_CONTENT,
  type NoteColumnId,
  PLACES_OF,
  parseCardId,
  type RelayDetails,
  type Sha256,
  type TaskId,
  type ThreadId,
  textCardId,
  textSourceOf,
  WRAPS,
  workflowStateIdFor,
  writerId,
} from "./index.ts"

const ADA = writerId("ada@x.io")
const UUID = "01a0ffd2-0000-7000-8000-00000000000a"

describe("KINDS", () => {
  test("every id prefix is distinct, and none can begin a uuidv7: a bare id is a text card's", () => {
    const prefixes = Object.values(KINDS).flatMap(k =>
      k.prefix === null ? [] : [k.prefix],
    )
    expect(new Set(prefixes).size).toBe(prefixes.length)
    for (const prefix of prefixes) {
      // A uuidv7 opens with eight hex digits: a `-` second never matches one.
      expect(prefix).toMatch(/^[a-z]-$/)
      expect(kindOfCard(`${prefix}${UUID}` as never)).not.toBe("text")
    }
    expect(kindOfCard(textCardId(UUID))).toBe("text")
    for (const kind of Object.keys(KINDS) as CardKind[])
      if (KINDS[kind].prefix !== null)
        expect(kindOfCard(`${KINDS[kind].prefix}${UUID}` as never)).toBe(kind)
  })

  test("a card of every kind, minted (cardIdOfKind), parses as that kind's id", () => {
    for (const kind of Object.keys(KINDS) as CardKind[]) {
      const id = cardIdOfKind(kind, UUID)
      expect([kind, parseCardId(id), kindOfCard(id)]).toEqual([kind, id, kind])
    }
    expect(parseCardId(`z-${UUID}`)).toBeUndefined()
  })

  test("a kind's places are PLACES_OF's; a fact is only ever queued, and no person moves it", () => {
    for (const kind of Object.keys(KINDS) as CardKind[])
      expect(PLACES_OF[kind]).toEqual(KINDS[kind].places)
    expect(KINDS.fact).toMatchObject({
      places: ["queued"],
      moves: false,
      reordered: false,
      text: "fact",
    })
  })

  test("a spot on a canvas is a target of each kind a canvas takes, and of each WRAPS makes a container for; of no other", () => {
    const spot = {
      kind: "canvas-at",
      task: "k-1" as TaskId,
      after: null,
    } as const
    for (const kind of Object.keys(KINDS) as CardKind[])
      expect([kind, isTargetOf(kind, spot)]).toEqual([
        kind,
        fitsPlace(kind, "canvas") || kind in WRAPS,
      ])
    expect(Object.keys(WRAPS).sort()).toEqual(["reference", "text"])
  })

  test("makeCard makes a card of its kind, at a place its kind is in, by its maker", () => {
    const thread = "t-1" as ThreadId
    const inventory = { kind: "inventory", holder: ADA } as const
    expect(makeCard("thread", thread, inventory, NO_CONTENT, ADA)).toEqual({
      kind: "thread",
      id: thread,
      owner: ADA,
      placer: ADA,
      place: inventory,
      content: {},
    })
    const queued = {
      kind: "queued",
      thread,
      order: "a",
      by: ADA,
      seen: "",
    } as const
    // @ts-expect-error: a thread's card is never queued
    makeCard("thread", thread, queued, NO_CONTENT, ADA)
    const fact = "x-1" as FactCardId
    // @ts-expect-error: a fact is never in an inventory
    makeCard("fact", fact, inventory, { fact: null as never }, ADA)
  })
})

test("a card's words are where its kind says (`KINDS`' text): textSourceOf agrees for every kind with records", () => {
  const place = { kind: "inventory", holder: ADA } as const
  const thread = "t-1" as ThreadId
  const cards = [
    makeCard(
      "text",
      textCardId(UUID),
      place,
      { command: null, unsent: null, origin: null },
      ADA,
    ),
    makeCard("thread", thread, place, NO_CONTENT, ADA),
    makeCard(
      "task",
      `k-${UUID}` as TaskId,
      { kind: "board", state: workflowStateIdFor("open"), order: "a" },
      NO_CONTENT,
      ADA,
    ),
    makeCard(
      "note-column",
      `n-${UUID}` as NoteColumnId,
      { kind: "canvas", task: `k-${UUID}` as TaskId, order: "a", width: 1 },
      NO_CONTENT,
      ADA,
    ),
    makeCard(
      "fact",
      `x-${UUID}` as FactCardId,
      { kind: "queued", thread, order: "a", by: ADA, seen: "" },
      { fact: { kind: "described", lane: thread, by: ADA } },
      ADA,
    ),
    makeCard(
      "ask",
      cardIdOfKind("ask", UUID),
      { kind: "queued", thread, order: "a", by: ADA, seen: "" },
      { relay: { text: "?" } as RelayDetails },
      ADA,
    ),
    makeCard(
      "reference",
      cardIdOfKind("reference", UUID),
      place,
      { address: { kind: "thread", thread }, quote: "a".repeat(64) as Sha256 },
      ADA,
    ),
  ]
  expect(cards.map(c => c.kind).sort()).toEqual(
    (Object.keys(KINDS) as CardKind[])
      .filter(k => k !== "media" && k !== "file")
      .sort(),
  )
  for (const card of cards)
    expect(textSourceOf(card).kind).toBe(KINDS[card.kind].text)
})
