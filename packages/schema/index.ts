// schema — the Kyneta document shape.
//
// Imports Kyneta ONLY. Deliberately pi-free: this is what let S7/S8/S12 test
// convergence with no harness in the picture, and that property is worth
// keeping. Nothing here knows what pi is.

import { batch, createDoc, loro } from "@kyneta/loro-schema"
import { Schema } from "@kyneta/schema"

/**
 * One session document, replicated host -> client.
 *
 * entries / usageRows / values / lists back pi's `Storage` port.
 *
 *   - `entries` is a RECORD keyed by UUIDv7, not a list: a Loro map is a
 *     per-key LWW register, and grow-only-set semantics emerge only because
 *     each key is written exactly once (ADR-0009). A list would duplicate on
 *     retry; `Schema.set` is rejected by the Loro backend.
 *   - No stored `seq` anywhere. `seq` is a derived replica-local arrival index
 *     (ADR-0013), so it is structurally impossible for it to replicate.
 *
 * `pendingText` is the live assistant stream: a `Schema.text()` per run, written
 * with insert(at, delta) and cleared on commit (ADR-0014). NOT `Schema.string()`
 * — a whole-value register is O(n^2) on every substrate, durable included.
 */
export const SessionDoc = loro.bind(
  Schema.struct({
    entries: Schema.record(Schema.any()),
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

export const readEntries = (doc: SessionDocHandle): Record<string, unknown> =>
  doc.entries()

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
