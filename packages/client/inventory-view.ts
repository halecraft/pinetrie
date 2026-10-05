// client/inventory-view — what the inventory panel draws (ADR-0048 step 4,
// ADR-0059). Pure: `settleSlots`, the one slot rule the repair writes too,
// each slot with its card.

import type { CardId, CardRecord } from "@pinetrie/core"
import {
  type Intents,
  SLOT_INDICES,
  type Slots,
  settleSlots,
} from "@pinetrie/session"

export interface SlotView {
  readonly index: number
  readonly card: CardRecord | null
  /** The card's first line, "" for none. */
  readonly firstLine: string
  /** "1"–"9" for the first nine slots, else null. */
  readonly label: string | null
  readonly selected: boolean
}

export interface InventoryView {
  readonly slots: readonly SlotView[]
  readonly selected: number
  /** The selected slot's card, shown whole beside the grid. */
  readonly card: CardRecord | null
  /** How many slots are empty. */
  readonly free: number
}

const firstLineOf = (text: string): string =>
  text.trimStart().split("\n", 1)[0]?.trim() ?? ""

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
  const slots = SLOT_INDICES.map(index => {
    const id = settled[String(index)]
    const card = id === undefined ? null : (byId.get(id) ?? null)
    return {
      index,
      card,
      firstLine:
        card === null ? "" : firstLineOf(input.texts.get(card.id) ?? ""),
      label: index < 9 ? String(index + 1) : null,
      selected: index === input.selected,
    }
  })
  return {
    slots,
    selected: input.selected,
    card: slots[input.selected]?.card ?? null,
    free: slots.filter(s => s.card === null).length,
  }
}
