// interface/inventory-view — what the inventory panel draws (ADR-0048 step 4,
// ADR-0059): `settleSlots`, the one slot rule the repair writes too, as a
// card grid (`gridView`), each of the first nine slots labelled 1–9. Pure.

import { type CardId, type CardRecord, INVENTORY_GRID } from "@pinetrie/core"
import { type Intents, type Slots, settleSlots } from "@pinetrie/session"
import { type GridView, gridView } from "./grid-view.ts"

export interface InventoryView {
  readonly grid: GridView
  /** How many slots are empty. */
  readonly free: number
}

/** "1"–"9" for the first nine slots, else null. */
export const slotKey = (slot: number): string | null =>
  slot < 9 ? String(slot + 1) : null

/** What the panel draws: `settleSlots`, each slot with its card. */
export function inventoryView(input: {
  readonly held: readonly CardRecord[]
  readonly slots: Slots
  readonly intents: Intents
  readonly selected: number
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
}): InventoryView {
  const byId = new Map(input.held.map(c => [c.id, c] as const))
  const settled = settleSlots(
    input.held.map(c => c.id),
    input.slots,
    input.intents,
  )
  const placed = new Map<number, CardRecord>()
  for (const [slot, id] of Object.entries(settled)) {
    const card = byId.get(id)
    if (card !== undefined) placed.set(Number(slot), card)
  }
  const grid = gridView({
    grid: INVENTORY_GRID,
    tone: "inventory",
    placed,
    selected: input.selected,
    texts: input.texts,
    keyOf: slotKey,
  })
  return { grid, free: grid.cells.length - placed.size }
}
