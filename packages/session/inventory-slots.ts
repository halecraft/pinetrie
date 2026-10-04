// session/inventory-slots — your inventory document's slots, repaired from
// the host's record (ADR-0059, S76, S79). Runs in a browser and in Node
// alike: it touches only the Exchange and the clock.
//
// The slots are written by this person's tabs only, and repaired on every
// change, but only once the host's copy has reached this one: repaired
// before then, an empty copy would fill slots that the stored layout already
// names, and the merge would move cards. `repairStep` (`inventory.ts`)
// decides each repair, and when to look again.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import type { CardId, WriterId } from "@pineta/core"
import { personDocId } from "@pineta/protocol/writers"
import { InventoryDoc, readSlots } from "@pineta/schema"
import {
  type HeldSince,
  type Intents,
  repairStep,
  type Slots,
  type SlotWrites,
  takeIntoInventoryWrites,
} from "./inventory.ts"
import { personDoc } from "./person-doc.ts"
import type { Readable } from "./store.ts"

export interface InventorySlots {
  /** The slots as your document holds them. */
  readonly slots: Readable<Slots>
  /** The slots as the document holds them now. */
  stored(): Slots
  /** Settle the slots towards the host's record, for the cards steady now. */
  repair(): void
  /** Write `writes` in one batch; nothing for none. */
  write(writes: SlotWrites): void
  /** An accepted take into the inventory: `card` into `slot`, and out of any other. */
  takeIntoInventory(card: CardId, slot: number): void
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
    /** The slots this tab's takes into the inventory in flight chose (`intentsOf`). */
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
    takeIntoInventory: (card, slot) =>
      write(takeIntoInventoryWrites(readSlots(inventory), card, slot)),
    dispose() {
      own.dispose()
      if (wake !== null) clearTimeout(wake)
    },
  }
}
