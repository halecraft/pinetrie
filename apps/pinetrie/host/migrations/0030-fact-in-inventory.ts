// host/migrations/0030-fact-in-inventory — an undelivered fact says its asker
// was `in-inventory`, with its `holder`, not `held` with its `by`: in that
// fact `by` is who acted. Facts in the old shape stop decoding: each is
// renamed in place, in every root's history and in every fact card still
// queued.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { FACT_TYPE } from "@pinetrie/rules"
import { queuedFactRow, rewriteHistory, rewritePlacesRows } from "./rewrite.ts"

/** A stored undelivered fact in the old shape, renamed; null for any other. */
export function factInInventory(fact: unknown): object | null {
  if (fact === null || typeof fact !== "object") return null
  const { kind, why } = fact as Readonly<Record<string, unknown>>
  if (kind !== "undelivered" || why === null || typeof why !== "object")
    return null
  const {
    kind: whyKind,
    by,
    ...rest
  } = why as Readonly<Record<string, unknown>>
  if (whyKind !== "held") return null
  return { ...fact, why: { ...rest, kind: "in-inventory", holder: by } }
}

export const factInInventoryMigration = rewriteHistory({
  name: "0030-fact-in-inventory",
  customType: FACT_TYPE,
  rewrite: factInInventory,
})

/** A places row holding a queued fact in the old shape, renamed; null for any other. */
export const queuedFactInInventory = queuedFactRow(factInInventory)

export const queuedFactInInventoryMigration = rewritePlacesRows({
  name: "0030-queued-fact-in-inventory",
  rewrite: queuedFactInInventory,
})
