// interface/presence — what a client shows of who else is here.
//
// Presence is thread-level: each column of the tab a person is on reports the
// end of the thread it follows. Someone is on your thread when their end and
// yours lie on one path: one is the other, or an ancestor of it (a column that
// has not yet caught up). Someone on a sibling branch is not.
//
// Each function takes one field's entries, so a part of the screen reads only
// the field it shows, and a write to another field redraws nothing of it.

import {
  type EntryId,
  pathIds,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"

/** A presence field's entries: one per key, its writer and the thread end. */
type Entries = readonly (readonly [WriterId, EntryId])[]

/**
 * Everyone but `me` whose value is `value`, each once: a person here from two
 * seats has two entries: who types at a thread end.
 */
export function othersWithValue(
  entries: Entries,
  value: EntryId,
  me: WriterId,
): WriterId[] {
  const out: WriterId[] = []
  for (const [w, at] of entries)
    if (w !== me && at === value && !out.includes(w)) out.push(w)
  return out
}

/** Others following each thread end, you left out: the rail's rings. */
export function othersReading(
  reading: Entries,
  me: WriterId,
): ReadonlyMap<EntryId, readonly WriterId[]> {
  const at = new Map<EntryId, WriterId[]>()
  for (const [w, end] of reading) {
    if (w === me) continue
    const here = at.get(end) ?? []
    if (!here.includes(w)) here.push(w)
    at.set(end, here)
  }
  return at
}

/** Others following the thread that ends at `end`: a column's header. */
export function seenBy(
  reading: Entries,
  me: WriterId,
  index: TreeIndex,
  end: EntryId,
): readonly WriterId[] {
  const mine = pathIds(index, end)
  const seen: WriterId[] = []
  for (const [w, theirs] of reading) {
    if (w === me || seen.includes(w)) continue
    if (mine.has(theirs) || pathIds(index, theirs).has(end)) seen.push(w)
  }
  return seen
}
