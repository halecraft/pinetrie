// host/migrations/0014-trash-left — a trashed card records the place it
// left. Its row was `discarded`, with whose trash and the task it left; now
// it is that place's own row, its kind prefixed `discarded-`. An old row
// says too little to rebuild where the card was, and it is at most a week
// old, so it is deleted. A value change only: the schema's hash holds. The
// text documents of the cards deleted go with the startup sweep, which
// removes a text no record names, and their histories with the provenance
// sweep.
//
// One-time: delete this file once Duane's store has run it.

import { batch } from "@kyneta/schema"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import { PlacesDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/** A stored row, its fields as strings. */
type Row = Readonly<Record<string, string>>

/** The ids of rows in the old trash shape, pure: none once they are gone. */
export const oldTrashRows = (rows: Readonly<Record<string, Row>>): string[] =>
  Object.entries(rows)
    .filter(([, row]) => row.kind === "discarded")
    .map(([id]) => id)
    .sort()

export const trashLeft: RecordMigration = {
  name: "0014-trash-left",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(PLACES_DOC_ID)) return null
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const ids = oldTrashRows(places.cards() as Readonly<Record<string, Row>>)
    if (ids.length === 0) return null
    return async () => {
      batch(places, d => {
        for (const id of ids) d.cards.delete(id)
      })
      places.rev.set(places.rev() + 1)
    }
  },
}
