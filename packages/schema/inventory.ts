// schema/inventory — which slot of your inventory holds which card
// (ADR-0059): a Yjs document per person, written only by that person's tabs.
//
// The host's places document says whose inventory a card is in; this says
// where in the grid it sits. Only your own tabs arrange it, and they may do
// so at once, so it merges; each tab then repairs it from the host's record
// (`planSlots` in @pinetrie/session). The host stores and relays it, shared with
// its person only (host/policy.ts), and never writes it; its id and who may
// write it are the protocol's (`@pinetrie/protocol/writers`).

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type CardId, parseCardId } from "@pinetrie/core"

/** Slot index ("0"–"17", reading order) to card id. An empty slot has no key. */
export const InventoryDoc = yjs.bind(
  Schema.struct({ slots: Schema.record(Schema.string()) }),
)

/** An inventory document, as the Exchange gives it. */
export type InventoryDocHandle =
  typeof InventoryDoc extends BoundSchema<infer S, infer N>
    ? DocRef<S, N>
    : never

/** An inventory document on its own, with no Exchange: for tests. */
export const newInventoryDoc = (): InventoryDocHandle => createDoc(InventoryDoc)

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
