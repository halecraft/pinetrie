// interface/inventory-view — what the inventory panel draws (ADR-0048 step 4,
// ADR-0059): `settleSlots`, the one slot rule the repair writes too, as a
// card grid (`gridView`), each of the first nine slots labelled 1–9, and the
// selected card's preview (ADR-0126). Pure.

import {
  type CardId,
  type CardRecord,
  type CardWidth,
  INVENTORY_GRID,
  type ThreadId,
} from "@pinetrie/core"
import { type Intents, type Slots, settleSlots } from "@pinetrie/session"
import type { DrawnCard } from "./face.ts"
import { type GridView, gridView } from "./grid-view.ts"
import type { ThreadFace } from "./thread-face.ts"

/**
 * The selected card, drawn beside the grid (ADR-0126): normal, one column
 * wide, read only. Opened, it is drawn whole in place instead.
 */
export interface CardPreview {
  readonly card: CardRecord
  readonly detail: "normal"
  readonly width: CardWidth
}

export interface InventoryView {
  readonly grid: GridView
  /** How many slots are empty. */
  readonly free: number
  /** The selected card's preview; null for an empty slot, or while it is open. */
  readonly preview: CardPreview | null
}

/** "1"–"9" for the first nine slots, else null. */
export const slotKey = (slot: number): string | null =>
  slot < 9 ? String(slot + 1) : null

/** What the panel draws: `settleSlots`, each slot with its card. */
export function inventoryView(input: {
  readonly held: readonly DrawnCard[]
  readonly slots: Slots
  readonly intents: Intents
  readonly selected: number
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's face, for a thread's card (ADR-0124). */
  readonly threads: ReadonlyMap<ThreadId, ThreadFace>
  /** The selected card is open, drawn whole in its slot. */
  readonly open: boolean
}): InventoryView {
  const byId = new Map<CardId, DrawnCard>(
    input.held.map(c => [c.id, c] as const),
  )
  const settled = settleSlots(
    input.held.map(c => c.id),
    input.slots,
    input.intents,
  )
  const placed = new Map<number, DrawnCard>()
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
    threads: input.threads,
    keyOf: slotKey,
  })
  return {
    grid,
    free: grid.cells.length - placed.size,
    preview:
      grid.card === null || input.open
        ? null
        : { card: grid.card, detail: "normal", width: 1 },
  }
}
