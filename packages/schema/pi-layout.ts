// schema/pi-layout — how pi's data is laid out in a root's document: the
// entry row, pi's values at their physical keys, a lane's tip, and the
// payload fields pine·trie reads. This package imports no pi;
// `KynetaStorage` (`packages/pi/storage.ts`) writes pi's values with
// `physicalKey` and `StoredValueRecord` from here.

import { Schema } from "@kyneta/schema"
import {
  type EntryId,
  entryId,
  isThreadId,
  type ThreadId,
} from "@pinetrie/core"
import type { RootDocHandle } from "./storage.ts"

/**
 * One entry as a root's document holds it: six typed columns, the
 * fields pine·trie reads, and pi's own fields sealed in `payload`, which never
 * repeats a column (`toStoredRow`, `packages/pi/stored-row.ts`). `type` is any
 * string, so a new pi entry type needs no schema change. `thread` is the
 * thread whose commit wrote the entry, never empty once written.
 * `.json()` stores the row as one leaf, since an entry is written once and
 * never edited. `TECHNICAL.md`, "The entry row", has the
 * reasons.
 */
export const StoredEntryRowSchema = Schema.struct.json({
  id: Schema.string(),
  parentId: Schema.string().nullable(),
  type: Schema.string(),
  timestamp: Schema.number(),
  fromId: Schema.string().nullable(),
  thread: Schema.string(),
  payload: Schema.any(),
})

/** One stored entry, its type derived from `StoredEntryRowSchema`. */
export type StoredEntryRow = ReturnType<RootDocHandle["entries"]>[string]

export const readEntries = (
  doc: RootDocHandle,
): Record<string, StoredEntryRow> => doc.entries()

/**
 * The record key for one of pi's values: `namespace`, a NUL, then `key`.
 *
 * pi addresses a value by a (namespace, key) pair. Folding the pair into one
 * record key is ours: `values` is a flat record, so each address is one leaf
 * register, with no child container for two replicas to create at once.
 * NUL is the separator pi's own in-memory storage uses; it cannot
 * appear in a namespace, and it sorts first, so one namespace's keys are
 * adjacent.
 *
 * The key is an identity, never parsed: it is matched by prefix only in
 * `valuePrefix`, and every stored value carries its `namespace` and `key` as
 * properties, which readers use.
 */
export const physicalKey = (namespace: string, key: string): string =>
  `${namespace}\u0000${key}`

/**
 * The physical-key prefix shared by every value in `namespace` whose key
 * starts with `keyPrefix`. The NUL ends the namespace, so namespace `a` does
 * not match `ab`.
 */
export const valuePrefix = (namespace: string, keyPrefix: string): string =>
  physicalKey(namespace, keyPrefix)

/**
 * One of pi's values as the document stores it, under
 * `physicalKey(namespace, key)`. `values` is `Schema.any()`, so this type is
 * what the writers and readers agree on.
 */
export interface StoredValueRecord {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
  /**
   * A token unique to the write. A changed `wid` tells a replica that a newer
   * write won the register. Absent on a record written outside
   * `KynetaStorage`, as `writeLaneTip` (`@pinetrie/schema/fixtures`) writes
   * one.
   */
  readonly wid?: string
  /** A checkpoint's shell: its text is in `checkpointText` under the same key. */
  readonly sealed?: true
}

/** pi's namespace for lane tips, keyed by lane name (a thread's id). */
export const LANE_TIP = "pi.branch.tip"

/** A stored value's own record of its address and contents. */
interface StoredAddress {
  readonly namespace?: unknown
  readonly key?: unknown
  readonly value?: unknown
}
const asStored = (v: unknown): StoredAddress | undefined =>
  v !== null && typeof v === "object" ? (v as StoredAddress) : undefined

/**
 * Whether the document records a lane named `lane` at all.
 *
 * This is the only way to tell "no lane" from "a lane at the root": pi writes
 * the lane's tip value when it creates a lane, null until the lane has an
 * entry, so `readLaneTip` returns null for both. Measured, not assumed: see
 * `packages/pi/TECHNICAL.md`.
 */
export function hasLaneRecord(doc: RootDocHandle, lane: ThreadId): boolean {
  return doc.values.get(physicalKey(LANE_TIP, lane)) !== undefined
}

/** A lane's tip entry id, or null if the lane has none (or does not exist). */
export function readLaneTip(
  doc: RootDocHandle,
  lane: ThreadId,
): EntryId | null {
  const value = asStored(doc.values.get(physicalKey(LANE_TIP, lane)))?.value
  return typeof value === "string" ? entryId(value) : null
}

/**
 * Every lane the document records: a thread's lanes, in name order (creation
 * order, since a lane's name holds a uuidv7), and the stored lanes no reader
 * is given. Read from each value's own `namespace` and `key` properties,
 * never by splitting the record key.
 */
export function readStoredLanes(doc: RootDocHandle): {
  readonly lanes: readonly ThreadId[]
  /**
   * Stored lane keys that fail `isThreadId`, or whose tip is neither an entry
   * id nor null: never a thread's lane, and never read as one at the root.
   */
  readonly malformed: readonly string[]
} {
  const lanes: ThreadId[] = []
  const malformed: string[] = []
  for (const { key, value } of readValues(doc, LANE_TIP))
    if (isThreadId(key) && (value === null || typeof value === "string"))
      lanes.push(key)
    else malformed.push(key)
  return { lanes: lanes.toSorted(), malformed: malformed.toSorted() }
}

/** Every thread's lane the document records, in name order (`readStoredLanes`). */
export const readLaneNames = (doc: RootDocHandle): readonly ThreadId[] =>
  readStoredLanes(doc).lanes

/**
 * Every one of pi's values in `namespace`, in no specified order, read from
 * each value's own `namespace` and `key` properties, never by parsing the
 * physical key.
 */
function readValues(
  doc: RootDocHandle,
  namespace: string,
): { readonly key: string; readonly value: unknown }[] {
  const out: { key: string; value: unknown }[] = []
  for (const stored of Object.values(doc.values())) {
    const s = asStored(stored)
    if (s?.namespace === namespace && typeof s.key === "string")
      out.push({ key: s.key, value: s.value })
  }
  return out
}

/**
 * Whether the root holds entry `id`, and if so its message, lifted out of its
 * sealed `payload`; the message is undefined for an entry that
 * carries none.
 */
export function readEntryMessage(
  doc: RootDocHandle,
  id: string,
): { present: false } | { present: true; message: unknown } {
  const row = doc.entries.get(id)
  return row === undefined || row === null
    ? { present: false }
    : { present: true, message: rowMessage(row) }
}

/** A row's message, lifted out of its sealed `payload`. */
export const rowMessage = (row: StoredEntryRow): unknown =>
  (row.payload as { message?: unknown } | null)?.message

/**
 * A compaction row's retained tail: the messages pi keeps after its summary,
 * stored on the compaction itself. Empty for any other row.
 */
export function rowRetainedTail(row: StoredEntryRow): readonly unknown[] {
  const tail = (row.payload as { retainedTail?: unknown } | null)?.retainedTail
  return row.type === "compaction" && Array.isArray(tail) ? tail : []
}
