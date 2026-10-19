// host/migrations/0021-relay-allowance — an ask relayed into a thread, and
// its answer, name the message whose allowance the chain spends `allowance`,
// not `budget`. One stored in the old shape does not decode, so the column
// drops it and a run reads no allowance: each is renamed in place, in every
// root's history and every ask card's row.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { ANSWER_TYPE, RELAY_TYPE } from "@pinetrie/rules"
import { renamedFields, rewriteHistory, rewritePlacesRows } from "./rewrite.ts"

const renameBudget = renamedFields({ budget: "allowance" })

export const relayAllowance = rewriteHistory({
  name: "0021-relay-allowance",
  customType: RELAY_TYPE,
  rewrite: renameBudget,
})

export const answerAllowance = rewriteHistory({
  name: "0021-answer-allowance",
  customType: ANSWER_TYPE,
  rewrite: renameBudget,
})

/** A places row whose ask card's relay, as JSON, names its budget; renamed; null for any other. */
export function askCardAllowance(row: unknown): object | null {
  if (row === null || typeof row !== "object") return null
  const { relay } = row as { readonly relay?: unknown }
  if (typeof relay !== "string" || relay === "") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(relay)
  } catch {
    return null
  }
  const renamed = renameBudget(parsed)
  return renamed === null ? null : { ...row, relay: JSON.stringify(renamed) }
}

export const askCardAllowanceMigration = rewritePlacesRows({
  name: "0021-ask-card-allowance",
  rewrite: askCardAllowance,
})
