import { textCardId, writerId } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  firstEmpty,
  NO_INTENTS,
  planSlots,
  putAwayWrites,
  repairStep,
  type Slots,
  STEADY_MS,
  settleSlots,
  steadiness,
  swapWrites,
} from "./inventory.ts"

const _ADA = writerId("ada@x.io")
const A = cardIdFor("ca")
const B = cardIdFor("cb")
const C = cardIdFor("cc")
/** Every card steady: the repair acts at once. */
const STEADY = () => true
const slotsOf = (o: Record<string, string>): Slots =>
  Object.fromEntries(Object.entries(o).map(([s, c]) => [s, textCardId(c)]))

describe("firstEmpty", () => {
  test("the start when it is empty, else the first empty in reading order, else null", () => {
    const some = slotsOf({
      "0": cardIdFor("ca"),
      "2": cardIdFor("cb"),
    })
    expect(firstEmpty(some, 5)).toBe(5)
    expect(firstEmpty(some, 2)).toBe(1)
    expect(firstEmpty(some)).toBe(1)
    const full = Object.fromEntries(
      Array.from({ length: 12 }, (_, n) => [String(n), textCardId(`c-${n}`)]),
    )
    expect(firstEmpty(full, 3)).toBeNull()
  })
})

describe("settleSlots and planSlots: the repair", () => {
  test("an unslotted held card goes in the first empty slot, in id order", () => {
    const slots = slotsOf({ "0": cardIdFor("cb") })
    expect(settleSlots([C, A, B], slots, NO_INTENTS)).toEqual({
      "0": B,
      "1": A,
      "2": C,
    })
    expect(planSlots([C, A, B], slots, NO_INTENTS, STEADY)).toEqual({
      set: { "1": A, "2": C },
      clear: [],
    })
  })

  test("a slot naming a card not held is cleared, and a slot that is no slot", () => {
    const slots = slotsOf({
      "3": cardIdFor("ca"),
      "4": cardIdFor("c103"),
      "99": cardIdFor("cb"),
    })
    expect(planSlots([A], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: ["4", "99"],
    })
  })

  test("a card in two slots keeps the lower", () => {
    const slots = slotsOf({
      "7": cardIdFor("ca"),
      "2": cardIdFor("ca"),
    })
    expect(settleSlots([A], slots, NO_INTENTS)).toEqual({ "2": A })
    expect(planSlots([A], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: ["7"],
    })
  })

  test("a card keeps its slot, gaps included; nothing to do gives no writes", () => {
    const slots = slotsOf({
      "5": cardIdFor("ca"),
      "11": cardIdFor("cb"),
    })
    expect(settleSlots([A, B], slots, NO_INTENTS)).toEqual(slots)
    expect(planSlots([A, B], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: [],
    })
  })

  test("a 13th held card is drawn in the row past the sixth", () => {
    const held = Array.from({ length: 13 }, (_, n) => textCardId(`c-${n}`))
    const slots = Object.fromEntries(
      held.slice(0, 12).map((c, n) => [String(n), c]),
    )
    expect(settleSlots(held, slots, NO_INTENTS)).toEqual({
      ...slots,
      "12": held[12],
    })
    expect(firstEmpty(settleSlots(held, slots, NO_INTENTS))).toBeNull()
  })

  test("holding 12 again, a card past the twelfth slot settles into the first empty", () => {
    const held = Array.from({ length: 12 }, (_, n) => textCardId(`c-${n}`))
    const slots = Object.fromEntries(
      held.map((c, n) => [String(n === 3 ? 13 : n), c]),
    )
    expect(settleSlots(held, slots, NO_INTENTS)["3"]).toBe(held[3])
    expect(planSlots(held, slots, NO_INTENTS, STEADY)).toEqual({
      set: { "3": held[3] },
      clear: ["13"],
    })
  })

  test("an intent's card is drawn in its chosen slot, and the repair writes nothing for it", () => {
    const slots = slotsOf({
      "0": cardIdFor("cb"),
      "4": cardIdFor("cc"),
    })
    const intents = new Map([
      [A, 4],
      [C, 9],
    ])
    // C's other slot, 4, is the intent A chose: C is drawn only where its
    // own take into the inventory put it.
    expect(settleSlots([A, B, C], slots, intents)).toEqual({
      "0": B,
      "4": A,
      "9": C,
    })
    expect(planSlots([A, B, C], slots, intents, STEADY)).toEqual({
      set: {},
      clear: [],
    })
  })

  test("a card not yet steady is neither placed nor has its slot cleared; a duplicate is settled at once", () => {
    const unsteady = (card: string) =>
      card !== cardIdFor("cb") && card !== cardIdFor("c103")
    // B newly held and unslotted: not placed yet. A gone card's slot: kept.
    expect(
      planSlots(
        [A, B],
        slotsOf({
          "0": cardIdFor("ca"),
          "3": cardIdFor("c103"),
        }),
        NO_INTENTS,
        unsteady,
      ),
    ).toEqual({ set: {}, clear: [] })
    // A in two slots, and a slot that is no slot: settled though nothing is steady.
    expect(
      planSlots(
        [A],
        slotsOf({
          "0": cardIdFor("ca"),
          "4": cardIdFor("ca"),
          x: cardIdFor("ca"),
        }),
        NO_INTENTS,
        () => false,
      ),
    ).toEqual({ set: {}, clear: ["4", "x"] })
  })

  test("steadiness: a card held, or not, for STEADY_MS; wake when the next one is", () => {
    const first = steadiness(
      new Map(),
      [A],
      slotsOf({ "2": cardIdFor("cb") }),
      1_000,
    )
    expect(first.steady(A)).toBe(false)
    expect(first.wake).toBe(1_000 + STEADY_MS)
    const later = steadiness(
      first.memory,
      [A],
      slotsOf({ "2": cardIdFor("cb") }),
      1_000 + STEADY_MS,
    )
    expect([later.steady(A), later.steady(B), later.wake]).toEqual([
      true,
      true,
      null,
    ])
    // B becomes held: its clock starts again.
    const changed = steadiness(
      later.memory,
      [A, B],
      slotsOf({ "2": cardIdFor("cb") }),
      5_000,
    )
    expect([changed.steady(A), changed.steady(B), changed.wake]).toEqual([
      true,
      false,
      5_000 + STEADY_MS,
    ])
  })

  test("a take into the inventory writes its slot, and clears any other slot holding the card", () => {
    expect(
      putAwayWrites(
        slotsOf({
          "2": cardIdFor("ca"),
          "3": cardIdFor("cb"),
        }),
        A,
        6,
      ),
    ).toEqual({
      set: { "6": A },
      clear: ["2"],
    })
  })

  test("a swap writes the cards it is given, clearing a slot given none", () => {
    expect(swapWrites(2, 5, [B, A])).toEqual({
      set: { "2": B, "5": A },
      clear: [],
    })
    expect(swapWrites(2, 5, [null, A])).toEqual({
      set: { "5": A },
      clear: ["2"],
    })
  })

  test("the repair writes nothing until a card is steady, and says when to look again", () => {
    const input = { held: [A], stored: {}, intents: NO_INTENTS }
    const first = repairStep(new Map(), { ...input, now: 1_000 })
    expect(first.writes).toEqual({ set: {}, clear: [] })
    expect(first.wake).toBe(1_000 + STEADY_MS)
    const then = repairStep(first.memory, { ...input, now: 1_000 + STEADY_MS })
    expect(then.writes).toEqual({ set: { "0": A }, clear: [] })
    expect(then.wake).toBeNull()
  })
})
