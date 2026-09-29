// core/presence — what the screen shows of who else is here. Pure.
//
// Presence is thread-level (ADR-0024): each column of the tab a person is on
// reports the end of the thread it follows (ADR-0029). Someone is on your thread when their end and yours lie on
// one path: one is the other, or an ancestor of it (a column that has not yet
// caught up). Someone on a sibling branch is not.

import type { WriterId } from "./index.ts"
import { pathIds, type TreeIndex } from "./tree.ts"

export interface PresenceView {
  /** Others following each thread end, from the columns they report: the rail's rings. */
  readonly readingAt: ReadonlyMap<string, readonly WriterId[]>
  /** Others following the thread that ends at `end`: a column's header. */
  seenBy(end: string): readonly WriterId[]
  /** Others typing into the composer at `end`. */
  typingAt(end: string): readonly WriterId[]
  /** Others editing the note `note`. */
  editingAt(note: string): readonly WriterId[]
}

/**
 * Everyone but `me` whose value is `value`, each once: a person here from two
 * seats has two entries (ADR-0037).
 */
function whoIsAt(
  entries: readonly (readonly [WriterId, string])[],
  value: string,
  me: WriterId,
): WriterId[] {
  const out: WriterId[] = []
  for (const [w, at] of entries)
    if (w !== me && at === value && !out.includes(w)) out.push(w)
  return out
}

export function presenceView(
  facts: {
    readonly reading: readonly (readonly [WriterId, string])[]
    readonly typing: readonly (readonly [WriterId, string])[]
    readonly editing: readonly (readonly [WriterId, string])[]
  },
  me: WriterId,
  index: TreeIndex,
): PresenceView {
  const others = facts.reading.filter(([w]) => w !== me)
  const readingAt = new Map<string, WriterId[]>()
  for (const [w, end] of others) {
    const at = readingAt.get(end) ?? []
    if (!at.includes(w)) at.push(w)
    readingAt.set(end, at)
  }
  return {
    readingAt,
    seenBy(end) {
      const mine = pathIds(index, end)
      const seen: WriterId[] = []
      for (const [w, theirs] of others) {
        const onPath = mine.has(theirs) || pathIds(index, theirs).has(end)
        if (onPath && !seen.includes(w)) seen.push(w)
      }
      return seen
    },
    typingAt: end => whoIsAt(facts.typing, end, me),
    editingAt: note => whoIsAt(facts.editing, note, me),
  }
}
