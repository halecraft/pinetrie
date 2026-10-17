// schema/attention — what a person has dealt with: how far they have read each
// thread, the run-end reports and ready proposed changes they marked "not needed", and
// the mentions they have seen. A Yjs document per person, written only by that
// person's tabs.
//
// It is a document of its own, not a part of the inventory's: read marks are
// written whenever a column reaches its thread's end, slots only when a card
// moves, and each keeps its own history.

import { type BoundSchema, type DocRef, Schema } from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import {
  type EntryId,
  entryId,
  isThreadId,
  type ThreadId,
} from "@pinetrie/core"

export const AttentionDoc = yjs.bind(
  Schema.struct({
    /**
     * Where this person started: a run-end report that ended, or a mention
     * written, at or before this entry id was before them. Set once, by the
     * first write; "" until then, which nothing is raised against.
     */
    since: Schema.string(),
    /**
     * The inbox's watermark (`inbox.ts`): every mention at or before it is
     * seen. It moves as mentions are seen, so run-end reports never read it.
     */
    mentionsSince: Schema.string(),
    /** Lane to the furthest entry read on it. */
    read: Schema.record(Schema.string()),
    /** Lane to the ask whose run-end report was marked "not needed". */
    dismissed: Schema.record(Schema.string()),
    /** Lane to its proposed changes' `ledger.source` when it was marked "not needed". */
    dismissedReady: Schema.record(Schema.string()),
    /** Mentions seen above `since`, by entry id. */
    seen: Schema.record(Schema.boolean()),
  }),
)

/** An attention document, as the Exchange gives it. */
export type AttentionDocHandle =
  typeof AttentionDoc extends BoundSchema<infer S, infer N>
    ? DocRef<S, N>
    : never

/** What a person has dealt with, as the document holds it, read. */
export interface Attention {
  /** "" before the first write. */
  readonly since: string
  /** "" before the first write. */
  readonly mentionsSince: string
  readonly read: ReadonlyMap<ThreadId, EntryId>
  readonly dismissed: ReadonlyMap<ThreadId, EntryId>
  /** Lane to the proposed changes' `ledger.source`, a commit id. */
  readonly dismissedReady: ReadonlyMap<ThreadId, string>
  readonly seen: ReadonlySet<string>
}

const byLane = <V>(
  record: Readonly<Record<string, string>>,
  value: (s: string) => V,
): ReadonlyMap<ThreadId, V> =>
  new Map(
    Object.entries(record).flatMap(([lane, v]) =>
      isThreadId(lane) ? [[lane, value(v)] as const] : [],
    ),
  )

/** The document, read; a key that is no lane is left out. */
export const readAttention = (doc: AttentionDocHandle): Attention => ({
  since: doc.since(),
  mentionsSince: doc.mentionsSince(),
  read: byLane(doc.read(), entryId),
  dismissed: byLane(doc.dismissed(), entryId),
  dismissedReady: byLane(doc.dismissedReady(), s => s),
  seen: new Set(
    Object.entries(doc.seen()).flatMap(([id, on]) => (on ? [id] : [])),
  ),
})
