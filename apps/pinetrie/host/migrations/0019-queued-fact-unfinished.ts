// host/migrations/0019-queued-fact-unfinished — a fact still queued on its
// thread, stored as JSON in its card's row, names an acceptance into
// unfinished work as `unfinished`, not `wip`. Such a row does not decode, so
// the card would vanish before its thread read it: each is renamed in place.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { historyUnfinished } from "./0018-history-unfinished.ts"
import { rewritePlacesRows } from "./rewrite.ts"

const toUnfinished = historyUnfinished("to")

/** A places row holding a queued fact into a WIP, renamed; null for any other. */
export function queuedFactUnfinished(row: unknown): object | null {
  if (row === null || typeof row !== "object") return null
  const { fact } = row as { readonly fact?: unknown }
  if (typeof fact !== "string" || fact === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fact)
  } catch {
    return null
  }
  const renamed = toUnfinished(parsed)
  return renamed === null ? null : { ...row, fact: JSON.stringify(renamed) }
}

export const queuedFactUnfinishedMigration = rewritePlacesRows({
  name: "0019-queued-fact-unfinished",
  rewrite: queuedFactUnfinished,
})
