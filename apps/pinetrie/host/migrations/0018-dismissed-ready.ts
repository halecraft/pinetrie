// host/migrations/0018-dismissed-ready — the attention document's
// `dismissedOffers` is named `dismissedReady`, so its schema's hash moves.
// Each person's dismissals move with it, the same commit under the same lane,
// so an item they marked "not needed" stays dismissed.
//
// A stored document keeps each field under a key hashed from its schema, so
// the old field cannot be read through the new schema: it is read from a
// snapshot opened under the old one (`AttentionDocBeforeReady`). This is the
// one write the host makes to a person's document. Delete this file, its test
// and `AttentionDocBeforeReady` once Duane's store has run it.

import { batch, createDoc, exportEntirety } from "@kyneta/schema"
import {
  AttentionDoc,
  AttentionDocBeforeReady,
  type AttentionDocHandle,
} from "@pinetrie/schema"
import type { Migration } from "./index.ts"

/** The dismissals to write: each old one the new field does not already hold. */
export const planDismissedReady = (
  old: Readonly<Record<string, string>>,
  now: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] =>
  Object.entries(old).filter(([lane, source]) => now[lane] !== source)

/** `doc`'s dismissals as the old schema stored them. */
export const storedDismissedOffers = (
  doc: AttentionDocHandle,
): Readonly<Record<string, string>> =>
  createDoc(AttentionDocBeforeReady, exportEntirety(doc)).dismissedOffers()

export const dismissedReady: Migration = {
  name: "0018-dismissed-ready",
  kind: "attention",
  from: AttentionDocBeforeReady.schemaHash,
  async run({ exchange, docIds, hydrated }) {
    const planned: {
      doc: AttentionDocHandle
      writes: readonly (readonly [string, string])[]
    }[] = []
    for (const docId of docIds) {
      const doc = exchange.get(docId, AttentionDoc)
      await hydrated(docId)
      planned.push({
        doc,
        writes: planDismissedReady(
          storedDismissedOffers(doc),
          doc.dismissedReady(),
        ),
      })
    }
    return async () => {
      for (const { doc, writes } of planned)
        if (writes.length > 0)
          batch(doc, d => {
            for (const [lane, source] of writes)
              d.dismissedReady.set(lane, source)
          })
    }
  },
}
