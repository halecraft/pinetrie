// client/projection — view-shaped reads of the session document.
//
// The facts the host also decides from (the tree, lanes, the outbox, rules,
// names, references) are read by `@pineta/reads`, shared with the host, so a
// composer cannot promise what the host will not do. What is here is only for
// drawing: a run's live text, and a count.
//
// Pure reads: no subscription, no caching, no pi.

import {
  readActiveRun,
  readEntries,
  readStream,
  type SessionDocHandle,
} from "@pineta/schema"

export interface StreamingView {
  readonly runId: string
  readonly text: string
}

/** A lane's live token deltas, or `null` when it is idle. */
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
