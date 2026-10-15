// folder/read — what a read of your folder copies into its line: the paths
// whose stamp moved since the last read, and those gone. A scan's stamps are
// kept only once the state they made is recorded, so a read that failed is
// planned again whole.

import type { FolderStamp } from "@pinetrie/core"

/** A read to make: what to copy, what to delete, and the stamps to keep once it is recorded. */
export interface ReadPlan {
  /** Paths new or whose stamp moved, sorted. */
  readonly changed: readonly string[]
  /** Paths the last read had and the scan has not, sorted. */
  readonly deleted: readonly string[]
  readonly stamps: ReadonlyMap<string, FolderStamp>
}

const sameStamp = (a: FolderStamp, b: FolderStamp): boolean =>
  a.kind === b.kind &&
  a.size === b.size &&
  a.ctimeNs === b.ctimeNs &&
  a.exec === b.exec &&
  a.target === b.target

/**
 * The read from `last`'s stamps to `scan`'s; null when nothing changed, so
 * no state is made.
 */
export function planRead(
  last: ReadonlyMap<string, FolderStamp>,
  scan: ReadonlyMap<string, FolderStamp>,
): ReadPlan | null {
  const changed = [...scan]
    .filter(([p, s]) => {
      const before = last.get(p)
      return before === undefined || !sameStamp(before, s)
    })
    .map(([p]) => p)
    .sort()
  const deleted = [...last.keys()].filter(p => !scan.has(p)).sort()
  return changed.length === 0 && deleted.length === 0
    ? null
    : { changed, deleted, stamps: scan }
}
