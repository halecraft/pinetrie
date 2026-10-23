// machine/retention — which of a project's snapshots may go, decided by
// each name's owner's rule alone, over its own names. No rule subtracts a
// kept set from the listing: a name nothing decided about stays, and the
// base, folder states and names of no owner are never this package's to
// delete.

import {
  type Deletable,
  type DeletableOwner,
  deletableSnapshot,
  type SnapshotId,
  type SnapshotOwner,
  snapshotId,
  snapshotOwner,
  type ThreadId,
} from "@pinetrie/core"
import { type SnapshotRow, snapshotCost } from "./snapshot-index.ts"

/** What a rule decides from: the index, its budget and the store's room. */
export interface RetentionFacts {
  readonly rows: readonly SnapshotRow[]
  /** Whether every root's records are in the index: until then no unindexed name goes. */
  readonly complete: boolean
  /** `lanes.store.snapshotMetadata`: what the kept entries' estimated metadata may come to. */
  readonly budget: number
  /** The store's unallocated room and its floor, as last sampled; null when not measured. */
  readonly room: {
    readonly unallocated: number
    readonly minimum: number
  } | null
  /** The most this step may delete. */
  readonly limit: number
}

/** One owner's rule: of its own names, those that may go. */
export type Retention<O extends SnapshotOwner> = (
  names: readonly string[],
  facts: RetentionFacts,
) => readonly (O extends DeletableOwner ? Deletable<O> : never)[]

/** A rule that keeps every name: the owner's own code decides, or nobody does. */
export const keepAll = (): readonly never[] => []

/** The listing split by `snapshotOwner`, before any rule sees it. */
export function partitionByOwner(
  names: readonly string[],
): Readonly<Record<SnapshotOwner, readonly string[]>> {
  const parts: Record<SnapshotOwner, string[]> = {
    entry: [],
    "folder-state": [],
    base: [],
    unknown: [],
  }
  for (const name of names) parts[snapshotOwner(name)].push(name)
  return parts
}

/**
 * Whether a kept row is never the least recently used to go: branched from,
 * or its lane's newest. The newest is by id, which a UUIDv7 orders by when
 * it was made. A reserved row is never kept, so never a candidate.
 */
export function isProtected(
  row: SnapshotRow,
  newest: ReadonlyMap<ThreadId, SnapshotId>,
): boolean {
  return row.branched || newest.get(row.lane) === row.snapshot
}

/** Each lane's newest row's snapshot, among those not gone. */
export function newestByLane(
  rows: readonly SnapshotRow[],
): ReadonlyMap<ThreadId, SnapshotId> {
  const newest = new Map<ThreadId, SnapshotId>()
  for (const r of rows) {
    if (r.state === "deleted" || r.state === "to-delete") continue
    const was = newest.get(r.lane)
    if (was === undefined || r.snapshot > was) newest.set(r.lane, r.snapshot)
  }
  return newest
}

/**
 * Entries that may go, in this order, at most `limit`:
 * 1. rows marked to delete, and rows deleted whose name is still listed (a
 *    deletion that failed or was cut short);
 * 2. names with no row, once the index is complete: every row is written
 *    before its snapshot, and the project's lock keeps other hosts out, so
 *    no one will ever name one;
 * 3. the least recently used kept rows, never a protected one, until the
 *    kept rows' estimated metadata is within the budget and the room, with
 *    what each frees, is above its floor.
 */
export const planEntryRetention: Retention<"entry"> = (names, facts) => {
  const listed = new Set(names)
  const byName = new Map(facts.rows.map(r => [r.snapshot as string, r]))
  const chosen: SnapshotId[] = []
  const take = (id: string) => {
    if (chosen.length < facts.limit) chosen.push(snapshotId(id))
  }
  for (const r of facts.rows)
    if (
      listed.has(r.snapshot) &&
      (r.state === "to-delete" || r.state === "deleted")
    )
      take(r.snapshot)
  if (facts.complete)
    for (const name of names) if (!byName.has(name)) take(name)

  const newest = newestByLane(facts.rows)
  const kept = facts.rows.filter(
    r => r.state === "kept" && listed.has(r.snapshot),
  )
  let cost = kept.reduce((sum, r) => sum + snapshotCost(r), 0)
  let freed = 0
  const roomLow = () =>
    facts.room !== null && facts.room.unallocated + freed < facts.room.minimum
  const evictable = kept
    .filter(r => !isProtected(r, newest))
    .sort((a, b) => a.used - b.used || a.snapshot.localeCompare(b.snapshot))
  for (const r of evictable) {
    if (!(cost > facts.budget || roomLow())) break
    if (chosen.length >= facts.limit) break
    take(r.snapshot)
    cost -= snapshotCost(r)
    freed += snapshotCost(r)
  }
  return chosen.map(id => deletableSnapshot("entry", id))
}

/** Each owner's rule, exhaustive: only entries are this package's to delete. */
export const RETENTION = {
  entry: planEntryRetention,
  // The folder code decides its states (`planKeep`); the upkeep never does.
  "folder-state": keepAll,
  base: keepAll,
  unknown: keepAll,
} as const satisfies { readonly [O in SnapshotOwner]: Retention<O> }
