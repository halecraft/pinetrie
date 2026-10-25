// host/migrations/0022-fact-allowance — a stop names the message whose
// allowance stopped it `allowance`, not `budget`, and agents using one up is
// an `allowance-spent` fact. Facts in the old words lose their allowance or
// stop decoding: each is renamed in place, in every root's history and in
// every fact card still queued.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { FACT_TYPE } from "@pinetrie/rules"
import { queuedFactRow, rewriteHistory, rewritePlacesRows } from "./rewrite.ts"

/** A stored fact in the old words, renamed; null for any other. */
export function factAllowance(fact: unknown): object | null {
  if (fact === null || typeof fact !== "object") return null
  const { budget, ...rest } = fact as Readonly<Record<string, unknown>>
  const kind = rest.kind === "budget-spent" ? "allowance-spent" : rest.kind
  if (budget === undefined && kind === rest.kind) return null
  return {
    ...rest,
    kind,
    ...(budget === undefined ? {} : { allowance: budget }),
  }
}

export const factAllowanceMigration = rewriteHistory({
  name: "0022-fact-allowance",
  customType: FACT_TYPE,
  rewrite: factAllowance,
})

/** A places row holding a queued fact in the old words, renamed; null for any other. */
export const queuedFactAllowance = queuedFactRow(factAllowance)

export const queuedFactAllowanceMigration = rewritePlacesRows({
  name: "0022-queued-fact-allowance",
  rewrite: queuedFactAllowance,
})
