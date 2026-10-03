// pi/queries — the rules of pi's `Storage` reads, over stored rows. They
// restate pi's `InMemoryStorageState`, which pi does not export; its
// conformance suite checks that they still agree. Pure.

import type {
  EntryCursor,
  EntryStructure,
  StorageBranchScan,
} from "@earendil-works/pi-agent-core"
import type { StoredEntryRow } from "@pineta/schema"
import type { Bounds } from "./arrivals.ts"
import { rowCustomType } from "./stored-row.ts"

/** pi orders value keys by Unicode code point, not UTF-16 code unit. */
export function compareKeys(left: string, right: string): number {
  const l = Array.from(left, c => c.codePointAt(0) ?? 0)
  const r = Array.from(right, c => c.codePointAt(0) ?? 0)
  const n = Math.min(l.length, r.length)
  for (let i = 0; i < n; i++) {
    const d = (l[i] ?? 0) - (r[i] ?? 0)
    if (d !== 0) return d
  }
  return l.length - r.length
}

/** The seqs past pi's exclusive cursor, in the order being read. */
export const boundsAfter = (
  ascending: boolean,
  cursor: EntryCursor | undefined,
): Bounds =>
  cursor === undefined
    ? {}
    : ascending
      ? { from: cursor.seq + 1 }
      : { to: cursor.seq - 1 }

export const inBounds = (seq: number, bounds: Bounds): boolean =>
  (bounds.from === undefined || seq >= bounds.from) &&
  (bounds.to === undefined || seq <= bounds.to)

/** pi's limit: none, or a count of at least zero. */
export const limitOf = (limit: number | undefined): number =>
  limit === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.trunc(limit) || 0)

/** A stored row and its local seq. */
export interface Located {
  readonly row: StoredEntryRow
  readonly seq: number
}

export const rowMatches = (
  row: StoredEntryRow,
  query: { readonly type?: string; readonly customType?: string },
): boolean =>
  (query.type === undefined || row.type === query.type) &&
  (query.customType === undefined || rowCustomType(row) === query.customType)

/** `start` and its ancestors, newest first. */
export function walkBranch(
  start: string,
  locate: (id: string) => Located | undefined,
): Located[] {
  const first = locate(start)
  if (first === undefined) throw new Error(`Unknown branch start: ${start}`)
  const path = [first]
  for (let at = first; at.row.parentId !== null; ) {
    const parent = locate(at.row.parentId)
    if (parent === undefined) throw new Error("Corrupt branch: missing parent")
    path.push(parent)
    at = parent
  }
  return path
}

/**
 * pi's branch scan over a path from `walkBranch`: in the query's order, up to
 * and including the stop entry, then filtered by type, customType and cursor,
 * then limited.
 */
export function selectBranch(
  path: readonly Located[],
  query: StorageBranchScan,
): Located[] {
  const oldestFirst = query.order === "oldestFirst"
  const ordered = oldestFirst ? path.toReversed() : path
  const stop = ordered.findIndex(
    ({ row }) => row.id === query.stopAtId || row.type === query.stopAtType,
  )
  const bounds = boundsAfter(oldestFirst, query.cursor)
  const selected = (stop === -1 ? ordered : ordered.slice(0, stop + 1)).filter(
    ({ row, seq }) => rowMatches(row, query) && inBounds(seq, bounds),
  )
  return selected.slice(0, limitOf(query.limit))
}

/** A row's structure, without its payload's variant data. */
export function structureOf({ row, seq }: Located): EntryStructure {
  const customType = rowCustomType(row)
  return {
    id: row.id,
    parentId: row.parentId,
    seq,
    timestamp: row.timestamp,
    // The column is an unconstrained string, so an entry type pi adds later
    // needs no schema change; pi wrote it as one of its own.
    type: row.type as EntryStructure["type"],
    ...(customType === undefined ? {} : { customType }),
  }
}
