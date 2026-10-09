import { type TextCard, textCardId, writerId } from "@pinetrie/core"
import { NO_INTENTS, type Slots, settleSlots } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { inventoryView, slotKey } from "./inventory-view.ts"

const ADA = writerId("ada@x.io")
const A = textCardId("c0000000-0000-7000-8000-00000000000a")
const B = textCardId("c0000000-0000-7000-8000-00000000000b")
const slotsOf = (o: Record<string, string>): Slots =>
  Object.fromEntries(Object.entries(o).map(([s, c]) => [s, textCardId(c)]))

describe("inventoryView", () => {
  const record = (id: typeof A): TextCard => ({
    kind: "text",
    id,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    carries: { kind: "message", command: null },
    unsent: null,
  })

  test("draws exactly settleSlots, the selection, and first lines", () => {
    const held = [record(A), record(B)]
    const slots = slotsOf({ "10": "c0000000-0000-7000-8000-00000000000b" })
    const view = inventoryView({
      held,
      slots,
      intents: NO_INTENTS,
      selected: 10,
      texts: new Map([[B, "\n  plan: ship it\nsecond line"]]),
    })
    const drawn = Object.fromEntries(
      view.grid.cells.flatMap(s =>
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
    expect(view.grid.card?.id).toBe(B)
    expect(view.grid.cells[10]).toMatchObject({
      face: {
        lines: "plan: ship it\nsecond line",
        key: null,
        tone: "inventory",
      },
      selected: true,
    })
    expect(view.free).toBe(16)
  })

  test("labels the first nine slots 1–9 on their faces", () => {
    const view = inventoryView({
      held: [record(A)],
      slots: slotsOf({ "0": "c0000000-0000-7000-8000-00000000000a" }),
      intents: NO_INTENTS,
      selected: 0,
      texts: new Map(),
    })
    expect(view.grid.cells[0]?.face?.key).toBe("1")
    expect(Array.from({ length: 18 }, (_, n) => slotKey(n))).toEqual([
      ..."123456789".split(""),
      ...Array(9).fill(null),
    ])
  })
})
