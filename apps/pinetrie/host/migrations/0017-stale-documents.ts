// host/migrations/0017-stale-documents — stored documents nothing writes
// any more, which the check of stored schemas reported at every start: the
// command Lines of the `pineta.control` topic, from before the rename, which
// the startup deletion of Lines no longer matches, and `pinetrie:cards`, the
// cards document the places and the inventories replaced.
//
// One-time: delete this file once Duane's store has run it.

import type { StoreMigration } from "./index.ts"

const OLD_LINES = "line:pineta.control:"
const OLD_CARDS = "pinetrie:cards"

export const staleDocuments: StoreMigration = {
  name: "0017-stale-documents",
  doomed: storedIds =>
    storedIds
      .filter(id => id === OLD_CARDS || id.startsWith(OLD_LINES))
      .toSorted(),
}
