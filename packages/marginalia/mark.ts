// mark — a title on an entry (ADR-0045). A root's mark titles its tab.
//
// The record is a host-written `pineta.mark` value keyed by the entry's id.
// The last write wins, since nobody types a title together (ADR-0023), and
// clearing a title deletes its record.

import {
  type EntryId,
  ERR,
  entryId,
  type MarkRecord,
  type Refusal,
  refused,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

/** pi value namespace for marks. The key is the entry's id. */
export const MARK_NAMESPACE = "pineta.mark"

// The shape only: the host is the session's one writer, and stores only
// titles `parseTitle` accepted, so the title rule is not repeated here.
const MarkSchema = Type.Object({
  entry: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  by: Type.String(),
  at: Type.Number(),
})

/** A mark -> the plain value stored in pi. */
export const encodeMark = (r: MarkRecord) => ({ ...r })

export const decodeMark = (value: unknown): MarkRecord | undefined =>
  decodeWith(MarkSchema, value, r => ({
    ...r,
    entry: entryId(r.entry),
    by: r.by as WriterId,
  }))

/** Stored `pineta.mark` values -> each entry's mark. */
export function markRecords(
  values: Iterable<{ readonly value: unknown }>,
): ReadonlyMap<EntryId, MarkRecord> {
  return new Map(decodeAll(values, decodeMark).map(r => [r.entry, r]))
}

export type MarkPlan =
  | Refusal
  /** The title is already stored, or there is none to clear: nothing is written. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly record: MarkRecord }
  | { readonly kind: "remove"; readonly entry: EntryId }

/** Decide a mark: set `entry`'s title, or clear it with null. */
export function planMark(input: {
  readonly entry: EntryId
  readonly title: string | null
  readonly by: WriterId
  readonly now: number
  readonly index: TreeIndex
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
}): MarkPlan {
  const { entry, title } = input
  if (input.index.entries[entry] === undefined)
    return refused(ERR.UNKNOWN_TARGET, "no such entry to title")
  const stored = input.marks.get(entry)?.title ?? null
  if (stored === title) return { kind: "unchanged" }
  return title === null
    ? { kind: "remove", entry }
    : {
        kind: "write",
        record: { entry, title, by: input.by, at: input.now },
      }
}
