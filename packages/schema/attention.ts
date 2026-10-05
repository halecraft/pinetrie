// schema/attention — what a person has dealt with (ADR-0077): how far they
// have read each thread, the verdicts and offers they marked "not needed",
// and the mentions they have seen. A Yjs document per person, written only
// by that person's tabs, so it is the same on every device of theirs. The host
// stores and relays it, shared with its person only (host/policy.ts), and
// never writes it; its id and who may write it are the protocol's
// (`personDocId`, `@pinetrie/protocol/writers`).
//
// It is a document of its own, not a part of the inventory's: read marks are
// written whenever a column reaches its thread's end, slots only when a card
// moves, and each keeps its own history (S101).

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import {
  type EntryId,
  entryId,
  isLaneName,
  type LaneName,
} from "@pinetrie/core"

export const AttentionDoc = yjs.bind(
  Schema.struct({
    /**
     * Where this person started: a verdict that ended, or a mention
     * written, at or before this entry id was before them. Set once, by the
     * first write; "" until then, which nothing is raised against.
     */
    since: Schema.string(),
    /**
     * The inbox's watermark (`inbox.ts`): every mention at or before it is
     * seen. It moves as mentions are seen, so verdicts never read it.
     */
    mentionsSince: Schema.string(),
    /** Lane to the furthest entry read on it. */
    read: Schema.record(Schema.string()),
    /** Lane to the ask whose verdict was marked "not needed". */
    dismissed: Schema.record(Schema.string()),
    /** Lane to its offer's `ledger.source` when it was marked "not needed". */
    dismissedOffers: Schema.record(Schema.string()),
    /** Mentions seen above `since`, by entry id. */
    seen: Schema.record(Schema.boolean()),
  }),
)

/** An attention document, as the Exchange gives it. */
export type AttentionDocHandle =
  typeof AttentionDoc extends BoundSchema<infer S, infer N>
    ? DocRef<S, N>
    : never

/** An attention document on its own, with no Exchange: for tests. */
export const newAttentionDoc = (): AttentionDocHandle => createDoc(AttentionDoc)

/** What a person has dealt with, as the document holds it, read. */
export interface Attention {
  /** "" before the first write. */
  readonly since: string
  /** "" before the first write. */
  readonly mentionsSince: string
  readonly read: ReadonlyMap<LaneName, EntryId>
  readonly dismissed: ReadonlyMap<LaneName, EntryId>
  /** Lane to the offer's `ledger.source`, a commit id. */
  readonly dismissedOffers: ReadonlyMap<LaneName, string>
  readonly seen: ReadonlySet<string>
}

const byLane = <V>(
  record: Readonly<Record<string, string>>,
  value: (s: string) => V,
): ReadonlyMap<LaneName, V> =>
  new Map(
    Object.entries(record).flatMap(([lane, v]) =>
      isLaneName(lane) ? [[lane, value(v)] as const] : [],
    ),
  )

/** The document, read; a key that is no lane is left out. */
export const readAttention = (doc: AttentionDocHandle): Attention => ({
  since: doc.since(),
  mentionsSince: doc.mentionsSince(),
  read: byLane(doc.read(), entryId),
  dismissed: byLane(doc.dismissed(), entryId),
  dismissedOffers: byLane(doc.dismissedOffers(), s => s),
  seen: new Set(
    Object.entries(doc.seen()).flatMap(([id, on]) => (on ? [id] : [])),
  ),
})
