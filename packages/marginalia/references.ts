// references — ADR-0006, realised by ADR-0017.
//
// A reference is a directed, SEMANTIC pointer from where it was attached to an
// entry or a span of one. It is stored as a pi value in REFERENCE_NAMESPACE,
// keyed by its own id, so it travels in pi's session and two writers citing
// the same entry never share an address (ADR-0016). Backlinks are derived by
// reading, never stored: a stored list per target is the S18 shape.
//
// This schema is the single authority on the reference shape. Pineta owns it.

import {
  type ChatAt,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type LaneName,
  type ReferenceId,
  type ReferenceTarget,
  referenceId,
  resolveTarget,
  type WriterLaneState,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"

/** pi value namespace. The key is the reference id. */
export type { ReferenceTarget }

export const REFERENCE_NAMESPACE = "pineta.reference"

const TargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal("entry"), id: Type.String() }),
  Type.Object({
    kind: Type.Literal("span"),
    id: Type.String(),
    // UTF-16 code units into `entryText`: exactly the string the client
    // renders, so a user's selection maps onto it directly.
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
  }),
])

export const ReferenceSchema = Type.Object({
  id: Type.String(),
  /** The entry it was attached at: where the author was reading, or their tip. */
  from: Type.String(),
  to: TargetSchema,
  /** The author's lane name, from the transport. */
  author: Type.String(),
})

type Wire = Static<typeof ReferenceSchema>

/** A decoded reference. Branded here, the one edge where they are minted. */
export interface Reference {
  readonly id: ReferenceId
  readonly from: EntryId
  readonly to: ReferenceTarget
  readonly author: LaneName
}

/** Stored value -> reference, or undefined if malformed (see `decodeWith`). */
export const decodeReference = (value: unknown): Reference | undefined =>
  decodeWith(ReferenceSchema, value, w => ({
    id: referenceId(w.id),
    from: entryId(w.from),
    to:
      w.to.kind === "entry"
        ? { kind: "entry", id: entryId(w.to.id) }
        : {
            kind: "span",
            id: entryId(w.to.id),
            start: w.to.start,
            end: w.to.end,
          },
    author: w.author as LaneName,
  }))

export interface ReferenceIndex {
  /** What each entry cites. */
  readonly from: ReadonlyMap<EntryId, readonly Reference[]>
  /** Each entry's backlinks. */
  readonly to: ReadonlyMap<EntryId, readonly Reference[]>
}

/**
 * Both directions in ONE pass, each list ascending by reference id. Sorted by
 * id, never by input order, so every replica shows the same list. The UI does
 * two map lookups per node, so rendering is O(references).
 */
export function indexReferences(refs: Iterable<Reference>): ReferenceIndex {
  const sorted = [...refs].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const from = new Map<EntryId, Reference[]>()
  const to = new Map<EntryId, Reference[]>()
  const add = (m: Map<EntryId, Reference[]>, k: EntryId, r: Reference) => {
    const list = m.get(k)
    if (list === undefined) m.set(k, [r])
    else list.push(r)
  }
  for (const r of sorted) {
    add(from, r.from, r)
    add(to, r.to.id, r)
  }
  return { from, to }
}

/**
 * What the host knows about the cited entry. Two facts a `string | undefined`
 * would merge: an entry that does not exist, and one with no message text (a
 * compaction). An entry reference needs only the entry; a span needs text.
 */
export type CitedEntry =
  | { readonly kind: "absent" }
  | { readonly kind: "entry"; readonly text: string | undefined }

export type ReferenceDecision =
  | { readonly kind: "write"; readonly reference: Reference }
  | { readonly kind: "refused"; readonly code: ErrCode }

/** Decide whether a citation may be written. Pure. */
export function planReference(input: {
  readonly author: LaneName
  readonly lane: WriterLaneState
  /** Where the author is reading: the reference's `from`. */
  readonly at: ChatAt
  readonly target: ReferenceTarget
  readonly cited: CitedEntry
  readonly newId: ReferenceId
}): ReferenceDecision {
  const { target, cited } = input
  // A reference is attached at an entry, never the root. Attached where the author is reading: an entry they chose, or their own
  // tip. A person who has only ever asked the agent has no lane, but can still
  // cite from what they read.
  const from = resolveTarget(input.lane, input.at)
  if (from.kind === "root") {
    return { kind: "refused", code: ERR.NO_LANE }
  }
  if (cited.kind === "absent")
    return { kind: "refused", code: ERR.UNKNOWN_TARGET }
  if (target.kind === "span") {
    const length = cited.text?.length
    if (
      length === undefined ||
      target.start >= target.end ||
      target.end > length
    ) {
      return { kind: "refused", code: ERR.INVALID_SPAN }
    }
  }
  return {
    kind: "write",
    reference: {
      id: input.newId,
      from: from.id,
      to: target,
      author: input.author,
    },
  }
}

/** Reference -> the plain value stored in pi. */
export const encodeReference = (r: Reference): Wire => ({
  id: r.id,
  from: r.from,
  to: r.to,
  author: r.author,
})
