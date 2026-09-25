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
    // Which run each lane is streaming, keyed by lane name. A missing key
    // means that lane is idle; nothing is ever set to "" to mean idle. One
    // entry per lane is what lets two writers stream at once.
    activeRuns: Schema.record(Schema.string()),
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

export function beginStream(
  doc: SessionDocHandle,
  lane: string,
  runId: string,
): void {
  batch(doc, d => {
    d.pendingText.set(runId, "")
    d.activeRuns.set(lane, runId)
  })
}

/** The run a lane is streaming, or undefined when the lane is idle. */
export function readActiveRun(
  doc: SessionDocHandle,
  lane: string,
): string | undefined {
  return doc.activeRuns.get(lane) ?? undefined
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

/**
 * Clear on commit — the committed entry is the durable record from here on.
 * The lane's key is DELETED, not set to "": absence is what "idle" means.
 */
export function endStream(
  doc: SessionDocHandle,
  lane: string,
  runId: string,
): void {
  batch(doc, d => {
    d.pendingText.delete(runId)
    if (d.activeRuns.get(lane) === runId) d.activeRuns.delete(lane)
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
 * The record key for one of pi's values: `namespace`, a NUL, then `key`.
 *
 * pi addresses a value by a (namespace, key) pair; that pair is pi's. Folding
 * it into ONE record key is ours: `values` is a flat record, so each address
 * becomes one leaf register and there is no child container to race when two
 * replicas write a new namespace at once (S18, ADR-0016). NUL is the
 * separator pi's own in-memory storage uses; it cannot appear in a namespace,
 * and it sorts first, so one namespace's keys are adjacent.
 *
 * The key is an IDENTITY, not a format to read back. It is built here and
 * nowhere else, and never parsed: every stored value also carries its
 * `namespace` and `key` as properties, and readers use those.
 */
export const physicalKey = (namespace: string, key: string): string =>
  `${namespace}\u0000${key}`

/** pi's namespace for lane tips, keyed by lane name (ADR-0011). pi's name. */
const LANE_TIP = "pi.branch.tip"

/** A stored value's own record of its address and contents. */
interface StoredAddress {
  readonly namespace?: unknown
  readonly key?: unknown
  readonly value?: unknown
}
const asStored = (v: unknown): StoredAddress | undefined =>
  v !== null && typeof v === "object" ? (v as StoredAddress) : undefined

/**
 * Whether the document records a lane named `lane` at all.
 *
 * This is the only way to tell "no lane" from "a lane at the root": pi writes
 * the lane's tip value when it creates a lane, null until the lane has an
 * entry, so `readLaneTip` returns null for both. Measured, not assumed: see
 * `packages/pi/TECHNICAL.md`.
 */
export function hasLaneRecord(doc: SessionDocHandle, lane: string): boolean {
  return doc.values.get(physicalKey(LANE_TIP, lane)) !== undefined
}

/** A lane's tip entry id, or null if the lane has none (or does not exist). */
export function readLaneTip(
  doc: SessionDocHandle,
  laneName: string,
): string | null {
  const value = asStored(doc.values.get(physicalKey(LANE_TIP, laneName)))?.value
  return typeof value === "string" ? value : null
}

/**
 * Every lane the document records. Read from each value's own `namespace` and
 * `key` properties, never by splitting the record key.
 */
export function readLaneNames(doc: SessionDocHandle): string[] {
  return readValues(doc, LANE_TIP).map(v => v.key)
}

/**
 * Every value in `namespace`, read from each value's own `namespace` and `key`
 * properties. Never parses a record key: the key is an identity (ADR-0016).
 */
export function readValues(
  doc: SessionDocHandle,
  namespace: string,
): { readonly key: string; readonly value: unknown }[] {
  const out: { key: string; value: unknown }[] = []
  for (const stored of Object.values(doc.values())) {
    const s = asStored(stored)
    if (s?.namespace === namespace && typeof s.key === "string")
      out.push({ key: s.key, value: s.value })
  }
  return out
}

/**
 * An entry's message, lifted out of its sealed `payload` (ADR-0015), or
 * undefined if the entry is absent or carries none. The one definition of
 * where a message lives in a stored row; the client's projection and the
 * host both read through it.
 */
export function readEntryMessage(
  doc: SessionDocHandle,
  id: string,
): { present: false } | { present: true; message: unknown } {
  const row = doc.entries.get(id)
  return row === undefined || row === null
    ? { present: false }
    : { present: true, message: rowMessage(row) }
}

/** A row's message, lifted out of its sealed `payload`. Pure; no lookup. */
export const rowMessage = (row: StoredEntryRow): unknown =>
  (row.payload as { message?: unknown } | null)?.message
