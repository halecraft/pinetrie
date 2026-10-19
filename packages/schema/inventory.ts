// schema/inventory — which slot of your inventory holds which card: a Yjs
// document per person, written only by that person's tabs.
//
// Your tabs may arrange it at once, so it merges; each tab then repairs it
// from the host's record (`planSlots` in @pinetrie/session).

import { type BoundSchema, type DocRef, Schema } from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type CardId, parseCardId } from "@pinetrie/threads"

/** Slot index ("0"–"17", reading order) to card id. An empty slot has no key. */
export const InventoryDoc = yjs.bind(
  Schema.struct({ slots: Schema.record(Schema.string()) }),
)

/** An inventory document, as the Exchange gives it. */
export type InventoryDocHandle =
  typeof InventoryDoc extends BoundSchema<infer S, infer N>
    ? DocRef<S, N>
    : never

/** The slots as stored, read as card ids. */
export const readSlots = (
  doc: InventoryDocHandle,
): Readonly<Record<string, CardId>> => {
  const out: Record<string, CardId> = {}
  for (const [slot, text] of Object.entries(doc.slots())) {
    const card = parseCardId(text)
    if (card !== undefined) out[slot] = card
  }
  return out
}
