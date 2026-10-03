// mark — a title on an entry (ADR-0045). A root's mark titles its tab.
//
// The record is a host-written `pineta.mark` value keyed by the entry's id.
// The last write wins, since nobody types a title together (ADR-0023), and
// clearing a title deletes its record.

import {
  type EntryId,
  ERR,
  type MarkRecord,
  type Refusal,
  refused,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

// The shape only: the host is the session's one writer, and stores only
// titles `parseTitle` accepted, so the title rule is not repeated here.
const MarkSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: Type.String(),
  at: Type.Number(),
})

/** Each entry's mark, at the entry's id. */
export const MARK: RecordSpec<MarkRecord, EntryId> = {
  namespace: "pineta.mark",
  keyOf: r => r.entry,
  encode: ({ entry, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(MarkSchema, contents, entryKey(key), (r, entry) => ({
      entry,
      title: r.title,
      by: r.by as WriterId,
      at: r.at,
    })),
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
