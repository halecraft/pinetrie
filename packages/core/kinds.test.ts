import { describe, expect, test } from "vitest"
import {
  type CardKind,
  type FactCardId,
  KINDS,
  kindOfCard,
  makeCard,
  NO_CONTENT,
  PLACES_OF,
  type ThreadId,
  textCardId,
  writerId,
} from "./index.ts"

const ADA = writerId("ada@x.io")
const UUID = "01a0ffd2-0000-7000-8000-00000000000a"

describe("KINDS (ADR-0126)", () => {
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
