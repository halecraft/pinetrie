// host/migrations/0018-history-unfinished — what an update merged, what a
// base's news named and where an acceptance went name unfinished work as
// `unfinished`, not `wip`. A message stored with the old word does not decode,
// so the column would drop it: each is renamed in place, in every root, its
// `content`, what the model read, untouched.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { BEHIND_TYPE, FACT_TYPE } from "@pinetrie/rules"
import { rewriteHistory } from "./rewrite.ts"

/** `field` of a stored message's details, when it names a WIP, renamed; null for any other. */
export const historyUnfinished =
  (field: string) =>
  (details: unknown): object | null => {
    if (details === null || typeof details !== "object") return null
    const named = (details as Readonly<Record<string, unknown>>)[field]
    if (named === null || typeof named !== "object") return null
    return (named as { readonly kind?: unknown }).kind === "wip"
      ? { ...details, [field]: { ...named, kind: "unfinished" } }
      : null
  }

export const updateUnfinished = rewriteHistory({
  name: "0018-update-unfinished",
  customType: "pinetrie.update",
  rewrite: historyUnfinished("from"),
})

export const behindUnfinished = rewriteHistory({
  name: "0018-behind-unfinished",
  customType: BEHIND_TYPE,
  rewrite: historyUnfinished("from"),
})

export const factUnfinished = rewriteHistory({
  name: "0018-fact-unfinished",
  customType: FACT_TYPE,
  rewrite: historyUnfinished("to"),
})
