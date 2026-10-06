import { type CardRecord, cardId, writerId } from "@pinetrie/core"
import { NO_INTENTS, type Slots, settleSlots } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { inventoryView } from "./inventory-view.ts"

const ADA = writerId("ada@x.io")
const A = cardId("c-a")
const B = cardId("c-b")
const slotsOf = (o: Record<string, string>): Slots =>
  Object.fromEntries(Object.entries(o).map(([s, c]) => [s, cardId(c)]))

describe("inventoryView", () => {
  const record = (id: typeof A): CardRecord => ({
    id,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    carries: { kind: "message", command: null },
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
