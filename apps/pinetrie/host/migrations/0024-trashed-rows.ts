// host/migrations/0024-trashed-rows — a trashed card's place is stored with
// its kind prefixed `trashed-`, and the trash itself as `trashed`, not
// `discarded-` and `discarded`. A row in the old words does not decode, so a
// card in a trash would vanish from it and its restore: each is rewritten
// wherever a place is stored flat, as `0003-one-margin` does, in the places
// document's rows and in each card's history and each trace.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { CARD_HISTORY, TRACE } from "@pinetrie/rules"
import { type Rewrite, rewritePlacesRows, rewriteRecords } from "./rewrite.ts"

type Raw = Readonly<Record<string, unknown>>
const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A place's flat fields with its kind in the new words; null for any already so. */
export const trashedFieldsNow: Rewrite = fields => {
  if (!isRaw(fields) || typeof fields.kind !== "string") return null
  const { kind } = fields
  if (kind === "discarded") return { ...fields, kind: "trashed" }
  if (kind.startsWith("discarded-"))
    return { ...fields, kind: `trashed-${kind.slice("discarded-".length)}` }
  return null
}

/** A move's `from` and `to` in the new words; null when neither changes. */
export const trashedMoveNow: Rewrite = move => {
  if (!isRaw(move)) return null
  const from = trashedFieldsNow(move.from)
  const to = trashedFieldsNow(move.to)
  return from === null && to === null
    ? null
    : { ...move, from: from ?? move.from, to: to ?? move.to }
}

/** A card's history with each event's places in the new words; null when none changes. */
export const trashedHistoryNow: Rewrite = history => {
  if (!isRaw(history) || !Array.isArray(history.events)) return null
  const events: readonly unknown[] = history.events
  const now = events.map(trashedMoveNow)
  return now.every(e => e === null)
    ? null
    : { ...history, events: now.map((e, i) => e ?? events[i]) }
}

export const trashedRows = rewritePlacesRows({
  name: "0024-trashed-rows",
  rewrite: trashedFieldsNow,
})

export const trashedHistories = rewriteRecords({
  name: "0024-trashed-histories",
  namespace: CARD_HISTORY.namespace,
  home: CARD_HISTORY.home,
  rewrite: trashedHistoryNow,
})

export const trashedTraces = rewriteRecords({
  name: "0024-trashed-traces",
  namespace: TRACE.namespace,
  home: TRACE.home,
  rewrite: trashedMoveNow,
})
