// interface/inventory-view — what the inventory panel draws: `settleSlots`,
// the one slot rule the repair writes too, as a card grid (`gridView`) that
// grows past its 12 slots only while you hold more, each of the first nine
// slots labelled 1–9; how many you hold of 12; and the bench, the selected
// slot drawn beside the grid.

import type { ThreadId, ThreadName, WriterId } from "@pinetrie/core"
import type { CardTitleRecord } from "@pinetrie/rules"
import { type Intents, type Slots, settleSlots } from "@pinetrie/session"
import {
  type CardId,
  INVENTORY_SLOTS,
  inventoryGrid,
  type MediaId,
  type TitledCardId,
} from "@pinetrie/threads"
import type { DrawnCard } from "./compact.ts"
import { type GridView, gridView } from "./grid-view.ts"
import type { MediaColumnView } from "./media-column-view.ts"
import type { ThreadGlance } from "./thread-glance.ts"

/**
 * The bench: the selected slot, one column wide. An empty slot says what it
 * is; a card is drawn normal and read only, or full once opened.
 */
type Bench =
  | { readonly kind: "empty"; readonly slot: number }
  | {
      readonly kind: "card"
      readonly card: DrawnCard
      readonly detail: "normal" | "full"
    }

interface InventoryView {
  readonly grid: GridView
  /** How many cards your inventory has, of `INVENTORY_SLOTS`: more while over. */
  readonly inventoryCount: number
  readonly bench: Bench
}

/** "1"–"9" for the first nine slots, else null. */
export const slotKey = (slot: number): string | null =>
  slot < 9 ? String(slot + 1) : null

/** What the panel draws: `settleSlots`, each slot with its card, and the bench. */
export function inventoryView(input: {
  readonly inventoryCards: readonly DrawnCard[]
  readonly slots: Slots
  readonly intents: Intents
  readonly selected: number
  /** You: whose cards the grid's × trashes. */
  readonly me: WriterId
  /** Each card's text, by id; one not yet read is "". */
  readonly texts: ReadonlyMap<CardId, string>
  /** Each thread's glance, for a thread's card. */
  readonly threads: ReadonlyMap<ThreadId, ThreadGlance>
  /** Each thread's name, which a reference names as where it is from. */
  readonly threadNames: ReadonlyMap<ThreadId, ThreadName>
  /** Each media column, as its column draws it. */
  readonly media: ReadonlyMap<MediaId, MediaColumnView>
  /** Each titled card's title. */
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** The bench has the selected card open, drawn full. */
  readonly open: boolean
}): InventoryView {
  const byId = new Map<CardId, DrawnCard>(
    input.inventoryCards.map(c => [c.id, c] as const),
  )
  const settled = settleSlots(
    input.inventoryCards.map(c => c.id),
    input.slots,
    input.intents,
  )
  const placed = new Map<number, DrawnCard>()
  for (const [slot, id] of Object.entries(settled)) {
    const card = byId.get(id)
    if (card !== undefined) placed.set(Number(slot), card)
  }
  const grid = gridView({
    grid: inventoryGrid(input.inventoryCards.length),
    tone: "inventory",
    placed,
    selected: input.selected,
    me: input.me,
    texts: input.texts,
    threads: input.threads,
    threadNames: input.threadNames,
    media: input.media,
    titles: input.titles,
    keyOf: slotKey,
  })
  return {
    grid,
    inventoryCount: input.inventoryCards.length,
    bench:
      grid.card === null
        ? { kind: "empty", slot: input.selected }
        : {
            kind: "card",
            card: grid.card,
            detail: input.open ? "full" : "normal",
          },
  }
}

/** The panel's count: "8/12", "13/12" while over. */
export const inventoryCountWords = (inventoryCount: number): string =>
  `${inventoryCount}/${INVENTORY_SLOTS}`

/** What an empty slot on the bench says. */
export const emptyBenchWords = (slot: number): string =>
  `slot ${slot + 1} · empty: drop or paste a card here`
