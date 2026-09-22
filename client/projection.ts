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

import { type EntryLike, projectTranscript } from "@pineta/core"
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
  // The doc stores entries as opaque JSON (`Schema.any()`), so this is the one
  // place the untyped substrate meets our typed core. `EntryLike` is
  // deliberately permissive: projectTranscript filters non-messages itself.
  const entries = readEntries(doc) as Record<string, EntryLike>
  const lane = readLane(doc)
  return projectTranscript(
    entries,
    lane === null ? null : readLaneTip(doc, lane),
  )
}

/** Live token deltas, or `null` when no run is active. */
export function readStreaming(doc: SessionDocHandle): StreamingView | null {
  const runId = doc.activeRunId()
  return runId === "" ? null : { runId, text: readStream(doc, runId) }
}

export function readEntryCount(doc: SessionDocHandle): number {
  return Object.keys(readEntries(doc)).length
}
