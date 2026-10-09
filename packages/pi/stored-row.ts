// pi/stored-row — pi's `Entry` split into the document's typed row, and
// rejoined (ADR-0015). Pure.

import type { Entry } from "@earendil-works/pi-agent-core"
import type { ThreadId } from "@pinetrie/core"
import type { StoredEntryRow } from "@pinetrie/schema"
import {
  type BlobOf,
  type RefOf,
  rejoinImages,
  splitImages,
} from "./stored-images.ts"

/**
 * `Omit` over a union collapses it to the keys common to every member, which
 * for pi's `Entry` discards `message`, `summary`, `fromId` and the rest. The
 * conditional distributes over the union instead, so each variant keeps its
 * own fields. Distribution needs a naked type parameter, hence the helper.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

/**
 * pi's `Entry` minus `seq`: what a commit hands over, in memory.
 * `StoredEntryRow` is what sits in the document.
 */
export type EntryWithoutSeq = DistributiveOmit<Entry, "seq">

/**
 * The columns `StoredEntryRow` hoists out of the entry. Listed once, so the
 * split and the rejoin cannot disagree about which keys are columns.
 */
const HOISTED = ["id", "parentId", "type", "timestamp", "fromId"] as const

/**
 * Keys `payload` must never carry: the hoisted columns, `thread`, which is a
 * column pi's entry does not have, plus `seq`.
 *
 * `seq` needs naming here even though the write path already strips it. The
 * columns are typed, so an undeclared key cannot reach them. `payload` is
 * `Schema.any()`, so a `seq` that got in there would persist and replicate,
 * which ADR-0013 forbids. A test asserts both halves.
 */
const NEVER_IN_PAYLOAD: readonly string[] = [...HOISTED, "thread", "seq"]

/**
 * Entry -> the row we persist (ADR-0015).
 *
 * `payload` carries the variant data and ONLY that. Putting the whole entry in
 * it would give `parentId` two homes, and nothing would keep them equal:
 * `planArrivals` orders arrivals from the column while a renderer could read
 * the blob. A round-trip test cannot detect that, because rejoining from
 * either copy yields the same entry. The guard is the disjointness case in
 * `stored-row.test.ts`.
 *
 * A message's image parts whose blob `refOf` finds are stored as references,
 * without their bytes (ADR-0051). `thread` is the thread whose commit wrote
 * it (`commitThread`, ADR-0125): pi's entry has no such field.
 */
export function toStoredRow(
  entry: EntryWithoutSeq,
  refOf: RefOf,
  thread: ThreadId,
): StoredEntryRow {
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(entry)) {
    if (NEVER_IN_PAYLOAD.includes(k)) continue
    payload[k] = k === "message" ? splitImages(v, refOf) : v
  }
  return {
    id: entry.id,
    parentId: entry.parentId,
    type: entry.type,
    timestamp: entry.timestamp,
    // `fromId` exists only on `branch_summary`, so the discriminant narrows it
    // rather than a cast. If pi ever renames or drops that variant, this
    // comparison stops type-checking, which is the warning we want.
    // Absent and null are different facts: the column records null and
    // `fromStoredRow` restores absence.
    fromId: entry.type === "branch_summary" ? entry.fromId : null,
    thread,
    payload,
  }
}

/**
 * Row -> pi's `Entry`, identical to what pi wrote.
 *
 * `seq` is supplied by the caller rather than read from the row: it is a
 * replica-local arrival index (ADR-0013) and never lives in the document.
 * Passing it here keeps the pairing with `toStoredRow` visible in the type.
 *
 * The return needs a double cast, because a union member cannot be built from
 * a dynamic object. What that cast actually trusts is narrower than it looks:
 *
 *   - the COLUMNS are typed by the Kyneta schema, and a row from a peer on a
 *     different build materializes missing fields as schema defaults rather
 *     than as garbage (measured in S17/P1c), so they are well-formed.
 *   - the WRITE path is checked by pi's own `validateCommittedWrites`.
 *   - a reference in `payload` is rejoined with the bytes `blobOf` reads, or
 *     with a line saying the blob is gone (`rejoinImages`).
 *   - `payload` is unchecked, and is not checkable here. pi ships no schema
 *     for `Entry` (its typebox use is for tool parameters), so validating it
 *     would mean hand-writing a copy of pi's shape in this repository, which
 *     is the coupling ADR-0015 exists to avoid.
 *
 * So the residual is provenance for `payload`, which is ADR-0015's open
 * question, not a defect in this function.
 */
export function fromStoredRow(
  row: StoredEntryRow,
  seq: number,
  blobOf: BlobOf,
): Entry {
  const payload = row.payload as Record<string, unknown>
  const rebuilt: Record<string, unknown> = {
    ...payload,
    ...("message" in payload
      ? { message: rejoinImages(payload.message, blobOf) }
      : {}),
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    timestamp: row.timestamp,
    seq,
  }
  // Restore absence: a message entry never carried `fromId` at all.
  if (row.fromId !== null) rebuilt.fromId = row.fromId
  return rebuilt as unknown as Entry
}

/**
 * A row's `customType`, which lives in `payload`: it is pi's variant data,
 * not one of the columns pinetrie reasons about.
 */
export function rowCustomType(row: StoredEntryRow): string | undefined {
  const customType = (row.payload as { customType?: unknown } | null)
    ?.customType
  return typeof customType === "string" ? customType : undefined
}
