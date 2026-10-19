// host/migrations/0014-state-get-latest — a folder lane's state that merged
// new work into it was made by `get-latest`, not `catch-up`. A state in the
// old word does not decode, so the history would lose it: each is renamed in
// place. Its id, an opaque disk name, keeps its prefix.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { STATE } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

/** A stored state made by the old word, renamed; null for any other. */
export function stateGetLatest(contents: unknown): object | null {
  if (contents === null || typeof contents !== "object") return null
  const { made } = contents as { readonly made?: unknown }
  if (made === null || typeof made !== "object") return null
  return (made as { readonly kind?: unknown }).kind === "catch-up"
    ? { ...contents, made: { ...made, kind: "get-latest" } }
    : null
}

export const stateGetLatestMigration = rewriteRecords({
  name: "0014-state-get-latest",
  namespace: STATE.namespace,
  home: STATE.home,
  rewrite: stateGetLatest,
})
