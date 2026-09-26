// core/presence — what the screen shows of who else is here. Pure.
//
// Presence is thread-level (ADR-0024): each open column reports the end of the
// thread it follows. Someone is on your thread when their end and yours lie on
// one path: one is the other, or an ancestor of it (a column that has not yet
// caught up). Someone on a sibling branch is not.

import type { WriterId } from "./index.ts"
import { pathIds, type TreeIndex } from "./tree.ts"

export interface PresenceView {
  /** Others following each thread end, from all their open columns: the rail's rings. */
  readonly readingAt: ReadonlyMap<string, readonly WriterId[]>
  /** Others following the thread that ends at `end`: a column's header. */
  seenBy(end: string): readonly WriterId[]
  /** Others typing into the composer at `end`. */
  typingAt(end: string): readonly WriterId[]
}

export function presenceView(
  facts: {
    readonly reading: readonly (readonly [WriterId, string])[]
    readonly typing: ReadonlyMap<WriterId, string>
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
    typingAt: end =>
      [...facts.typing].flatMap(([w, at]) =>
        w !== me && at === end ? [w] : [],
      ),
  }
}
