// interface/left — where you last left a thread: the furthest entry you have
// read on its lane, on any device of yours, from your attention document
// (`@pinetrie/session`'s `attention-doc.ts`).

import type { EntryId } from "@pinetrie/core"
import { ancestry, type TreeIndex } from "@pinetrie/threads"

/**
 * The message a "since you were here" line goes before: the first of `ids`,
 * a column's messages in path order, below the entry it was left at. That
 * entry can be no message (a tool's result, the lane's tip), so it is found
 * on the path, not among `ids`. None when it is not on the column's path, or
 * nothing came after it.
 */
export function leftLine(
  index: TreeIndex,
  at: EntryId | undefined,
  ids: readonly EntryId[],
): EntryId | null {
  const end = ids.at(-1)
  if (at === undefined || end === undefined) return null
  const above = new Set(ancestry(index, at).path)
  if (!new Set(ancestry(index, end).path).has(at)) return null
  return ids.find(id => !above.has(id)) ?? null
}
