import { describe, expect, test } from "vitest"
import {
  cardFlight,
  INVENTORY_CLOSED,
  type InventoryAct,
  type InventoryState,
  inventoryReducer,
  isInventoryShown,
} from "./inventory-state.ts"

const after = (state: InventoryState, ...acts: InventoryAct[]) =>
  acts.reduce(inventoryReducer, state)

const peek: InventoryAct = { kind: "show", how: "peek" }

describe("inventoryReducer", () => {
  test("the toggle opens it held, and closes it", () => {
    const open = after(INVENTORY_CLOSED, { kind: "toggle" })
    expect(open.shown).toEqual({ kind: "held" })
    expect(isInventoryShown(after(open, { kind: "toggle" }))).toBe(false)
  })

  test("the toggle pressed during a peek holds it open", () => {
    expect(after(INVENTORY_CLOSED, peek, { kind: "toggle" }).shown).toEqual({
      kind: "held",
    })
  })

  test("a take's peek closes at its own end", () => {
    const peeking = after(INVENTORY_CLOSED, peek)
    expect(peeking.shown).toEqual({ kind: "peek", id: 1 })
    expect(
      isInventoryShown(after(peeking, { kind: "peek-ended", id: 1 })),
    ).toBe(false)
  })

  test("engaged, a peek stays open past its end", () => {
    const engaged = after(INVENTORY_CLOSED, peek, { kind: "engage" })
    expect(engaged.shown).toEqual({ kind: "held" })
    expect(after(engaged, { kind: "peek-ended", id: 1 }).shown).toEqual({
      kind: "held",
    })
  })

  test("an older peek's end leaves a newer peek open", () => {
    const again = after(INVENTORY_CLOSED, peek, peek)
    expect(again.shown).toEqual({ kind: "peek", id: 2 })
    expect(after(again, { kind: "peek-ended", id: 1 }).shown).toEqual({
      kind: "peek",
      id: 2,
    })
  })

  test("a show never lowers held to a peek or a refusal", () => {
    const held = after(INVENTORY_CLOSED, { kind: "toggle" })
    expect(after(held, peek).shown).toEqual({ kind: "held" })
    expect(after(held, { kind: "show", how: "refusal" }).shown).toEqual({
      kind: "held",
    })
  })

  test("a refusal closes when the person acts elsewhere; held does not", () => {
    const refused = after(INVENTORY_CLOSED, { kind: "show", how: "refusal" })
    expect(after(refused, { kind: "peek-ended", id: 0 }).shown).toEqual({
      kind: "refusal",
    })
    expect(isInventoryShown(after(refused, { kind: "acted-elsewhere" }))).toBe(
      false,
    )
    const held = after(INVENTORY_CLOSED, { kind: "toggle" })
    expect(after(held, { kind: "acted-elsewhere" }).shown).toEqual({
      kind: "held",
    })
  })

  test("Escape folds the bench's open card first, then closes the panel", () => {
    const opened = after(INVENTORY_CLOSED, { kind: "toggle" }, { kind: "open" })
    const folded = after(opened, { kind: "escape" })
    expect([folded.bench, folded.shown.kind]).toEqual(["normal", "held"])
    expect(isInventoryShown(after(folded, { kind: "escape" }))).toBe(false)
  })

  test("selecting a slot folds the bench", () => {
    const opened = after(INVENTORY_CLOSED, { kind: "toggle" }, { kind: "open" })
    expect(after(opened, { kind: "select", slot: 3 })).toMatchObject({
      selected: 3,
      bench: "normal",
    })
  })
})

test("a card flies into your inventory as a ghost, anywhere else in place", () => {
  expect(cardFlight({ kind: "inventory", holder: "ada@x.test" as never })).toBe(
    "ghost",
  )
  expect(cardFlight({ kind: "trash" })).toBe("in-place")
})
