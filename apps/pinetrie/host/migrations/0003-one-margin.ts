// host/migrations/0003-one-margin — a comment's place names what it is on by
// address: a margin row stored as its entry's id in `at` and the entry's
// thread in `lane` becomes the entry's printed address in `at`, `lane` "" and
// `seen` "" (`placeFields`). Rewritten wherever a place is stored flat: each
// card's row in the places document, live or trashed, and each place in a
// card's history and a trace in the session. Over its own output it plans
// nothing: an address holds `/`, an entry's id never does.

import { batch } from "@kyneta/schema"
import { SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  applyRecordWrites,
  PlacesDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const MARGIN_KINDS = ["margin", "discarded-margin"]

/** A place's flat fields in the address form; null for any not a margin in the old one. */
export function marginFieldsNow<T>(fields: T): T | null {
  if (!isRaw(fields) || !MARGIN_KINDS.includes(String(fields.kind))) return null
  const { at, lane } = fields
  if (typeof at !== "string" || typeof lane !== "string") return null
  if (at === "" || at.includes("/") || lane === "") return null
  return { ...fields, at: `e/${lane}/${at}`, lane: "", seen: "" }
}

/** Each places row whose margin changes, whole, by card id. */
export function planMarginRows<T>(
  rows: Readonly<Record<string, T>>,
): ReadonlyMap<string, T> {
  const changed = new Map<string, T>()
  for (const [id, row] of Object.entries(rows)) {
    const now = marginFieldsNow(row)
    if (now !== null) changed.set(id, now)
  }
  return changed
}

/**
 * Each history's or trace's contents whose places change, whole: an event's
 * `from` and `to`, or a trace's.
 */
export function planMarginEvents(
  stored: Readonly<Record<string, unknown>>,
  namespace: "pinetrie.card-history" | "pinetrie.trace",
): readonly ValueWrite<"session">[] {
  const either = (fields: unknown): unknown => marginFieldsNow(fields) ?? fields
  return Object.entries(stored).flatMap(([key, contents]) => {
    if (!isRaw(contents)) return []
    const value =
      namespace === "pinetrie.trace"
        ? { ...contents, from: either(contents.from), to: either(contents.to) }
        : Array.isArray(contents.events)
          ? {
              ...contents,
              events: contents.events.map((e: unknown) =>
                isRaw(e) ? { ...e, from: either(e.from), to: either(e.to) } : e,
              ),
            }
          : contents
    return JSON.stringify(value) === JSON.stringify(contents)
      ? []
      : [
          {
            kind: "set",
            target: SESSION_TARGET,
            namespace,
            key,
            value,
          } as const,
        ]
  })
}

export const ONE_MARGIN: RecordMigration = {
  name: "0003-one-margin",
  async run({ exchange, docIds, hydrated }) {
    const places = docIds.includes(PLACES_DOC_ID)
      ? exchange.get(PLACES_DOC_ID, PlacesDoc)
      : null
    if (places !== null) await hydrated(PLACES_DOC_ID)
    const session = docIds.includes(SESSION_DOC_ID)
      ? exchange.get(SESSION_DOC_ID, SessionDoc)
      : null
    if (session !== null) await hydrated(SESSION_DOC_ID)
    const rows = places === null ? new Map() : planMarginRows(places.cards())
    const writes =
      session === null
        ? []
        : (["pinetrie.card-history", "pinetrie.trace"] as const).flatMap(ns =>
            planMarginEvents(readNamespace(session, ns), ns),
          )
    if (rows.size === 0 && writes.length === 0) return null
    return async () => {
      if (places !== null && rows.size > 0)
        batch(places, d => {
          for (const [id, row] of rows) d.cards.set(id, row)
        })
      if (session !== null && writes.length > 0)
        applyRecordWrites(session, writes)
    }
  },
}
