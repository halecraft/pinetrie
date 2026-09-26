// client/projection — view-shaped reads of the session document.
//
// The facts the host also decides from (the tree, lanes, the outbox, rules,
// names, references) are read by `@pineta/reads`, shared with the host, so a
// composer cannot promise what the host will not do. What is here is only for
// drawing: a count. Live replies and tool output are read with `readStreams`
// in `@pineta/schema`.
//
// Pure reads: no subscription, no caching, no pi.

import { readEntries, type SessionDocHandle } from "@pineta/schema"

export function readEntryCount(doc: SessionDocHandle): number {
  return Object.keys(readEntries(doc)).length
}
