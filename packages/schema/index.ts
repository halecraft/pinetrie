// schema — the Kyneta document shape.
//
// Imports Kyneta ONLY. Deliberately pi-free: this is what let S7/S8/S12 test
// convergence with no harness in the picture, and that property is worth
// keeping. Nothing here knows what pi is.

import { batch, createDoc, loro } from "@kyneta/loro-schema"
import { Schema } from "@kyneta/schema"

/**
 * One entry as it sits in the document (ADR-0015).
 *
 * Six typed columns plus one sealed leaf. The columns are exactly what Pineta
 * itself reasons about: the tree edge, plus the fields `projectTranscript`,
 * `orderNewEntries` and fold read. Everything pi-specific stays in `payload`.
 *
 *   - `type` is an UNCONSTRAINED string on purpose. A new pi `EntryType` then
 *     needs no schema change here at all. A `discriminatedUnion` would demand
 *     one every time, and its discriminant must be a constrained literal.
 *   - `.json()` makes the whole entry ONE inert leaf: Kyneta classifies a
 *     `.json()` node as `register`, stored as a single tuple rather than
 *     decomposed into per-field state. That is exactly right for entries,
 *     which are written once and never edited (ADR-0004, ADR-0009), so
 *     per-field CRDT merge is machinery we would never use.
 *   - No `seq` column. ADR-0013 is now STRUCTURAL for stored entries: an
 *     undeclared key cannot be written through a typed struct, the same way
 *     `Schema.struct` already protects Line messages on the wire.
 *
 * `payload` is pi's variant data and ONLY that. It must never carry a copy of
 * a column above. See `toStoredRow` in `packages/pi/storage.ts`.
 */
const StoredEntryRowSchema = Schema.struct.json({
  id: Schema.string(),
  parentId: Schema.string().nullable(),
  type: Schema.string(),
  timestamp: Schema.number(),
  fromId: Schema.string().nullable(),
  payload: Schema.any(),
})

/**
 * One session document, replicated host -> client.
 *
 * entries / usageRows / values / lists back pi's `Storage` port.
 *
 *   - `entries` is a RECORD keyed by UUIDv7, not a list: a Loro map is a
 *     per-key LWW register, and grow-only-set semantics emerge only because
 *     each key is written exactly once (ADR-0009). A list would duplicate on
 *     retry; `Schema.set` is rejected by the Loro backend.
 *   - `usageRows`, `values` and `lists` stay `Schema.any()`. They are pi's
 *     bookkeeping for its `Storage` port, not Pineta's domain model, and
 *     nothing of ours traverses them. The asymmetry with `entries` is
 *     deliberate: we type what we reason about.
 *
 * `pendingText` is the live assistant stream: a `Schema.text()` per run, written
 * with insert(at, delta) and cleared on commit (ADR-0014). NOT `Schema.string()`
 * — a whole-value register is O(n^2) on every substrate, durable included.
 */
export const SessionDoc = loro.bind(
  Schema.struct({
    entries: Schema.record(StoredEntryRowSchema),
    usageRows: Schema.record(Schema.any()),
    values: Schema.record(Schema.any()),
    lists: Schema.record(Schema.list(Schema.any())),
    pendingText: Schema.record(Schema.text()),
    // Which run is currently streaming, "" when idle. A small whole-value
    // register is the right shape here: it is replaced, never appended to.
    activeRunId: Schema.string(),
  }),
)

export const newSessionDoc = () => createDoc(SessionDoc)

/**
 * A live handle on the session document.
 *
 * Derived from the value rather than hand-written, so the doc shape above stays
 * the single source of truth. `exchange.get(id, SessionDoc)` yields this exact
 * type, so host/ and client/ share it without restating anything.
 */
export type SessionDocHandle = ReturnType<typeof newSessionDoc>

// --- pendingText helpers (ADR-0014) ----------------------------------------

export function beginStream(doc: SessionDocHandle, runId: string): void {
  batch(doc, d => {
    d.pendingText.set(runId, "")
    d.activeRunId.set(runId)
  })
}

/** Append a streamed delta. Only the inserted characters go on the wire. */
export function appendStream(
  doc: SessionDocHandle,
  runId: string,
  delta: string,
): void {
  if (delta.length === 0) return
  batch(doc, d => {
    const ref = d.pendingText.at(runId)
    if (ref === undefined) return
    ref.insert(ref().length, delta)
  })
}

export function readStream(doc: SessionDocHandle, runId: string): string {
  const ref = doc.pendingText.at(runId)
  return ref === undefined ? "" : ref()
}

/** Clear on commit — the committed entry is the durable record from here on. */
export function endStream(doc: SessionDocHandle, runId: string): void {
  batch(doc, d => {
    d.pendingText.delete(runId)
    if (d.activeRunId() === runId) d.activeRunId.set("")
  })
}

// --- read helpers used by the client ---------------------------------------

/**
 * One stored entry, derived from the schema rather than restated, so the shape
 * above stays the single source of truth.
 */
export type StoredEntryRow = ReturnType<SessionDocHandle["entries"]>[string]

/**
 * Write one entry row.
 *
 * Takes the TYPED row, not `unknown`: reading is receiving, where anything
 * might arrive, but writing is our own act and the shape can be demanded
 * (ADR-0015).
 *
 * The caller supplies `id`. Nothing here mints one, because entry-id
 * uniqueness is a safety invariant (ADR-0009) and a same-key write is
 * silently discarded by the per-key LWW register. Id minting stays with pi's
 * `IdGenerator`.
 */
export function writeEntry(doc: SessionDocHandle, row: StoredEntryRow): void {
  doc.entries.set(row.id, row)
}

export const readEntries = (
  doc: SessionDocHandle,
): Record<string, StoredEntryRow> => doc.entries()

/**
 * pi stores the lane tip in the `values` record under a physical key of
 * `namespace \u0000 key`, with namespace `pi.branch.tip` keyed by LANE NAME
 * (ADR-0011). Reading it does not require pi.
 */
export function readLaneTip(
  doc: SessionDocHandle,
  laneName: string,
): string | null {
  const stored = doc.values.get(`pi.branch.tip\u0000${laneName}`)
  if (stored === null || typeof stored !== "object") return null
  const value = (stored as { value?: unknown }).value
  return typeof value === "string" ? value : null
}

export function readLaneNames(doc: SessionDocHandle): string[] {
  return Object.keys(doc.values())
    .filter(k => k.startsWith("pi.branch.tip\u0000"))
    .map(k => k.slice("pi.branch.tip\u0000".length))
}
