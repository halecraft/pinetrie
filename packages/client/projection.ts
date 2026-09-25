// client/projection — read the session doc into renderable values.
//
// ONE definition, used by both readers. The React tree calls these inside
// `useTracked` for granular re-render; `session-view` composes them into the
// snapshot the Node e2e check asserts on. When these were written twice, the
// e2e suite was asserting against a projection the browser no longer ran —
// the apparatus had drifted from the system under test, which is the failure
// this project keeps meeting. Keep it single.
//
// Pure reads: no subscription, no caching, no pi.

import {
  type EntryLike,
  latestTip,
  projectSpine,
  projectTranscript,
  type SpineProjection,
} from "@pineta/core"
import {
  decodeReference,
  indexReferences,
  REFERENCE_NAMESPACE,
  type Reference,
  type ReferenceIndex,
} from "@pineta/marginalia"
import {
  readActiveRun,
  readEntries,
  readLaneNames,
  readLaneTip,
  readStream,
  readValues,
  rowMessage,
  type SessionDocHandle,
} from "@pineta/schema"

export interface StreamingView {
  readonly runId: string
  readonly text: string
}

/**
 * The tip a window should show when it has no selection of its own: its own
 * lane's tip, or, for a window that has not written yet, the most recently
 * advanced lane in the session.
 */
export function readDefaultViewTip(
  doc: SessionDocHandle,
  ownLane: string,
): string | null {
  return (
    readLaneTip(doc, ownLane) ??
    latestTip(readLaneNames(doc).map(lane => readLaneTip(doc, lane)))
  )
}

/**
 * Transcript order comes from the parentId walk, never from seq (ADR-0013:
 * seq is a replica-local arrival index and nothing may render by it). Entries
 * carry no seq at all, so this is structural rather than a matter of care.
 */
export function readTranscript(
  doc: SessionDocHandle,
  lane: string,
): ReturnType<typeof projectTranscript> {
  return projectTranscript(readRenderableEntries(doc), readLaneTip(doc, lane))
}

/**
 * Stored rows -> the shape the projections render (ADR-0015).
 *
 * `id`, `parentId` and `type` are typed columns, read straight off the row.
 * `message` is pi's variant data in the sealed `payload`; it is lifted by
 * `rowMessage` in `packages/schema`, the one definition of where a message
 * lives in a row. The host reaches it through `readEntryMessage`.
 */
export function readRenderableEntries(
  doc: SessionDocHandle,
): Record<string, EntryLike> {
  const out: Record<string, EntryLike> = {}
  for (const [id, row] of Object.entries(readEntries(doc))) {
    out[id] = {
      id: row.id,
      parentId: row.parentId,
      type: row.type,
      message: rowMessage(row) as EntryLike["message"],
    }
  }
  return out
}

/**
 * The spine for a chosen tip, plus the branches leaving it.
 *
 * `selectedTipId` is client-local: which path you are LOOKING at, which is not
 * the same as the lane tip the host appends to. Passing it in rather than
 * reading the lane is what makes navigation a read-only operation.
 */
export function readSpine(
  doc: SessionDocHandle,
  selectedTipId: string | null,
): SpineProjection {
  return projectSpine(readRenderableEntries(doc), selectedTipId)
}

/** The lane's own tip: where the host will append the next entry. */
/**
 * This lane's live token deltas, or `null` when it is idle. Other writers'
 * runs stream into the same document but are not this window's stream.
 */
export function readStreaming(
  doc: SessionDocHandle,
  lane: string,
): StreamingView | null {
  const runId = readActiveRun(doc, lane)
  return runId === undefined ? null : { runId, text: readStream(doc, runId) }
}

export function readEntryCount(doc: SessionDocHandle): number {
  return Object.keys(readEntries(doc)).length
}

/**
 * Every reference in the document, indexed both ways (ADR-0017). Values are
 * decoded totally: a malformed one is skipped, so it cannot break a render.
 * The single read path for references; the host's e2e uses it too.
 */
export function readReferences(doc: SessionDocHandle): ReferenceIndex {
  const refs: Reference[] = []
  for (const { value } of readValues(doc, REFERENCE_NAMESPACE)) {
    const r = decodeReference(value)
    if (r !== undefined) refs.push(r)
  }
  return indexReferences(refs)
}
