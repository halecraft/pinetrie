// host/migrations/0016-base-unfinished — a lane started from unfinished work
// records its base as `unfinished`, not `wip`. An old record does not decode,
// so the lane would read as having no base: each is renamed in place. Its
// bookmark keeps its name: `wip/` is jj's, and stays.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { BASE } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

/** A stored base record on a WIP, its base's kind renamed; null for any other. */
export function baseUnfinished(contents: unknown): object | null {
  if (contents === null || typeof contents !== "object") return null
  const { base } = contents as { readonly base?: unknown }
  if (base === null || typeof base !== "object") return null
  return (base as { readonly kind?: unknown }).kind === "wip"
    ? { ...contents, base: { ...base, kind: "unfinished" } }
    : null
}

export const baseUnfinishedMigration = rewriteRecords({
  name: "0016-base-unfinished",
  namespace: BASE.namespace,
  home: BASE.home,
  rewrite: baseUnfinished,
})
