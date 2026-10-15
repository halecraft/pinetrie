// host/migrations/0015-lane-history — a lane's record names the kind of
// history its own copy keeps. It stored its work, `{ kind: "own" }` or null,
// kept from when a lane could work directly; now it stores `history`. Every
// project served before folder projects was a jj project, so every own copy
// is jj's. A record's contents change and no schema's hash does.
//
// One-time: delete this file once Duane's store has run it.

import { LANE } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

/** A stored lane record with `work`, as one with `history`; null for one already moved. */
export function laneHistoryRewrite(contents: unknown): object | null {
  if (
    contents === null ||
    typeof contents !== "object" ||
    !("work" in contents)
  )
    return null
  const { work, ...rest } = contents as { readonly work: unknown }
  const own =
    work !== null &&
    typeof work === "object" &&
    (work as { readonly kind?: unknown }).kind === "own"
  return { ...rest, history: own ? "jj" : null }
}

export const laneHistory = rewriteRecords({
  name: "0015-lane-history",
  namespace: LANE.namespace,
  home: "session",
  rewrite: laneHistoryRewrite,
})
