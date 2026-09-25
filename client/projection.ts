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
  projectSpine,
  projectTranscript,
  type SpineProjection,
} from "@pineta/core"
import {
  readEntries,
  readLaneNames,
  readLaneTip,
  readStream,
  type SessionDocHandle,
} from "@pineta/schema"

export interface StreamingView {
  readonly runId: string
  readonly text: string
}

/** The lane this replica renders. `null` before the host has claimed one. */
export function readLane(doc: SessionDocHandle): string | null {
  return readLaneNames(doc)[0] ?? null
}

/**
 * Transcript order comes from the parentId walk, never from seq (ADR-0013:
 * seq is a replica-local arrival index and nothing may render by it). Entries
 * carry no seq at all, so this is structural rather than a matter of care.
 */
export function readTranscript(
  doc: SessionDocHandle,
): ReturnType<typeof projectTranscript> {
  const entries = readRenderableEntries(doc)
  const lane = readLane(doc)
  return projectTranscript(
    entries,
    lane === null ? null : readLaneTip(doc, lane),
  )
}

/**
 * Stored rows -> the shape the projections render (ADR-0015).
 *
 * `id`, `parentId` and `type` are typed columns now, so they are read straight
 * off the row. `message` is pi's variant data and lives in the sealed
 * `payload`, so it is lifted here. One place puts the two halves of a stored
 * entry back together for rendering.
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
      message: (row.payload as { message?: EntryLike["message"] }).message,
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
export function readLaneTipId(doc: SessionDocHandle): string | null {
  const lane = readLane(doc)
  return lane === null ? null : readLaneTip(doc, lane)
}

/** Live token deltas, or `null` when no run is active. */
export function readStreaming(doc: SessionDocHandle): StreamingView | null {
  const runId = doc.activeRunId()
  return runId === "" ? null : { runId, text: readStream(doc, runId) }
}

export function readEntryCount(doc: SessionDocHandle): number {
  return Object.keys(readEntries(doc)).length
}
