import { type CardRecord, cardId, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  firstEmpty,
  inventoryView,
  NO_INTENTS,
  planSlots,
  type Slots,
  STEADY_MS,
  settleSlots,
  steadiness,
  stepSlot,
  takeWrites,
} from "./inventory.ts"

const ADA = writerId("ada@x.io")
const A = cardId("c-a")
const B = cardId("c-b")
const C = cardId("c-c")
/** Every card steady: the repair acts at once. */
const STEADY = () => true
const slotsOf = (o: Record<string, string>): Slots =>
  Object.fromEntries(Object.entries(o).map(([s, c]) => [s, cardId(c)]))

describe("firstEmpty", () => {
  test("the start when it is empty, else the first empty in reading order, else null", () => {
    const some = slotsOf({ "0": "c-a", "2": "c-b" })
    expect(firstEmpty(some, 5)).toBe(5)
    expect(firstEmpty(some, 2)).toBe(1)
    expect(firstEmpty(some)).toBe(1)
    const full = Object.fromEntries(
      Array.from({ length: 18 }, (_, n) => [String(n), cardId(`c-${n}`)]),
    )
    expect(firstEmpty(full, 3)).toBeNull()
  })
})

describe("settleSlots and planSlots: the repair (ADR-0059, S76)", () => {
  test("an unslotted held card goes in the first empty slot, in id order", () => {
    const slots = slotsOf({ "0": "c-b" })
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
    const slots = slotsOf({ "3": "c-a", "4": "c-gone", "99": "c-b" })
    expect(planSlots([A], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: ["4", "99"],
    })
  })

  test("a card in two slots keeps the lower", () => {
    const slots = slotsOf({ "7": "c-a", "2": "c-a" })
    expect(settleSlots([A], slots, NO_INTENTS)).toEqual({ "2": A })
    expect(planSlots([A], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: ["7"],
    })
  })

  test("a card keeps its slot, gaps included; nothing to do gives no writes", () => {
    const slots = slotsOf({ "5": "c-a", "11": "c-b" })
    expect(settleSlots([A, B], slots, NO_INTENTS)).toEqual(slots)
    expect(planSlots([A, B], slots, NO_INTENTS, STEADY)).toEqual({
      set: {},
      clear: [],
    })
  })

  test("an intent's card is drawn in its chosen slot, and the repair writes nothing for it", () => {
    const slots = slotsOf({ "0": "c-b", "4": "c-c" })
    const intents = new Map([
      [A, 4],
      [C, 9],
    ])
    // C's other slot, 4, is the intent A chose: C is drawn only where its
    // own take put it.
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

  test("a card not yet steady is neither placed nor has its slot cleared; a duplicate, or a slot that is no slot, is settled at once", () => {
    const unsteady = (card: string) => card !== "c-b" && card !== "c-gone"
    // B newly held and unslotted: not placed yet. A gone card's slot: kept.
    expect(
      planSlots(
        [A, B],
        slotsOf({ "0": "c-a", "3": "c-gone" }),
        NO_INTENTS,
        unsteady,
      ),
    ).toEqual({ set: {}, clear: [] })
    // A in two slots, and a slot that is no slot: settled though nothing is steady.
    expect(
      planSlots(
        [A],
        slotsOf({ "0": "c-a", "4": "c-a", x: "c-a" }),
        NO_INTENTS,
        () => false,
      ),
    ).toEqual({ set: {}, clear: ["4", "x"] })
  })

  test("steadiness: a card held, or not, for STEADY_MS; wake when the next one is", () => {
    const first = steadiness(new Map(), [A], slotsOf({ "2": "c-b" }), 1_000)
    expect(first.steady(A)).toBe(false)
    expect(first.wake).toBe(1_000 + STEADY_MS)
    const later = steadiness(
      first.memory,
      [A],
      slotsOf({ "2": "c-b" }),
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
      slotsOf({ "2": "c-b" }),
      5_000,
    )
    expect([changed.steady(A), changed.steady(B), changed.wake]).toEqual([
      true,
      false,
      5_000 + STEADY_MS,
    ])
  })

  test("a take writes its slot, and clears any other slot holding the card", () => {
    expect(takeWrites(slotsOf({ "2": "c-a", "3": "c-b" }), A, 6)).toEqual({
      set: { "6": A },
      clear: ["2"],
    })
  })
})

describe("inventoryView", () => {
  const record = (id: typeof A): CardRecord => ({
    id,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    command: null,
    unsent: null,
  })

  test("draws exactly settleSlots, with labels 1–9, the selection, and first lines", () => {
    const held = [record(A), record(B)]
    const slots = slotsOf({ "10": "c-b" })
    const view = inventoryView({
      held,
      slots,
      intents: NO_INTENTS,
      selected: 10,
      texts: new Map([[B, "\n  plan: ship it\nsecond line"]]),
    })
    const drawn = Object.fromEntries(
      view.slots.flatMap(s =>
        s.card === null ? [] : [[String(s.index), s.card.id]],
      ),
    )
    expect(drawn).toEqual(
      settleSlots(
        held.map(c => c.id),
        slots,
        NO_INTENTS,
      ),
    )
    expect(view.slots.map(s => s.label)).toEqual([
      ..."123456789".split(""),
      ...Array(9).fill(null),
    ])
    expect(view.card?.id).toBe(B)
    expect(view.slots[10]).toMatchObject({
      firstLine: "plan: ship it",
      selected: true,
    })
    expect(view.free).toBe(16)
  })
})

test("stepSlot moves through the 3 × 6 grid and stops at its edges", () => {
  expect(stepSlot(0, "left")).toBe(0)
  expect(stepSlot(0, "right")).toBe(1)
  expect(stepSlot(5, "right")).toBe(5)
  expect(stepSlot(1, "down")).toBe(7)
  expect(stepSlot(13, "down")).toBe(13)
  expect(stepSlot(7, "up")).toBe(1)
})
