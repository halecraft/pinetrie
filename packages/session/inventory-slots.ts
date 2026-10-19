// session/inventory-slots — your inventory document's slots, repaired from
// the host's record on every change once the host's copy has reached this
// one: an empty copy repaired earlier would fill slots the stored layout
// already names, and the merge would move cards.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { WriterId } from "@pinetrie/core"
import { personDocId } from "@pinetrie/protocol/writers"
import { InventoryDoc, readSlots } from "@pinetrie/schema"
import type { CardId } from "@pinetrie/threads"
import {
  type HeldSince,
  type Intents,
  putAwayWrites,
  repairStep,
  type Slots,
  type SlotWrites,
} from "./inventory.ts"
import { personDoc } from "./person-doc.ts"
import type { Readable } from "./store.ts"

interface InventorySlots {
  /** The slots as your document holds them. */
  readonly slots: Readable<Slots>
  /** The slots as the document holds them now. */
  stored(): Slots
  /** Settle the slots towards the host's record, for the cards steady now. */
  repair(): void
  /** Write `writes` in one batch; nothing for none. */
  write(writes: SlotWrites): void
  /** An accepted take into the inventory: `card` into `slot`, and out of any other. */
  putAway(card: CardId, slot: number): void
  dispose(): void
}

export function inventorySlots(
  exchange: Exchange,
  me: WriterId,
  host: string,
  inputs: {
    /**
     * The cards the host's records put in your inventory: not the drawn
     * ones, so a put in flight keeps its slot until the host accepts it,
     * and a refused put finds it there.
     */
    readonly held: () => readonly CardId[]
    /** The slots this tab's takes into the inventory in flight chose (`slotIntents`). */
    readonly intents: () => Intents
  },
): InventorySlots {
  const own = personDoc(
    exchange.get(personDocId("inventory", me), InventoryDoc),
    host,
    readSlots,
  )
  const inventory = own.doc
  const write = (writes: SlotWrites) => {
    if (Object.keys(writes.set).length === 0 && writes.clear.length === 0)
      return
    batch(inventory, d => {
      for (const slot of writes.clear) d.slots.delete(slot)
      for (const [slot, card] of Object.entries(writes.set))
        d.slots.set(slot, card)
    })
  }
  let heldSince: HeldSince = new Map()
  let wake: ReturnType<typeof setTimeout> | null = null
  const repair = () => {
    if (!own.ready()) return
    const step = repairStep(heldSince, {
      held: inputs.held(),
      stored: readSlots(inventory),
      intents: inputs.intents(),
      now: Date.now(),
    })
    heldSince = step.memory
    if (wake !== null) clearTimeout(wake)
    wake =
      step.wake === null
        ? null
        : setTimeout(repair, Math.max(0, step.wake - Date.now()))
    write(step.writes)
  }
  own.onChange(repair)
  repair()
  return {
    slots: own.value,
    stored: () => readSlots(inventory),
    repair,
    write,
    putAway: (card, slot) =>
      write(putAwayWrites(readSlots(inventory), card, slot)),
    dispose() {
      own.dispose()
      if (wake !== null) clearTimeout(wake)
    },
  }
}
