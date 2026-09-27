// client/here — who else is in the session, for the header (ADR-0030). Pure.
//
// Presence is thread-level (ADR-0024): each column of the tab a person is on
// reports the end of its thread. The header groups those by person, where
// `presenceView` groups them by thread end; "never you" is `presenceView`'s.

import { rootOf, type TreeIndex, type WriterId } from "@pineta/core"

export interface PersonHere {
  readonly writer: WriterId
  /** Each thread end they read, with its root. */
  readonly threads: readonly { readonly end: string; readonly root: string }[]
}

/**
 * `presenceView`'s `readingAt` (thread end -> the others there, you left out)
 * grouped by person, in `order` (`writerOrder`, so every window agrees). A
 * thread end the index lacks, not arrived yet, is left out.
 */
export function peopleHere(
  readingAt: ReadonlyMap<string, readonly WriterId[]>,
  index: TreeIndex,
  order: readonly WriterId[],
): readonly PersonHere[] {
  const threads = new Map<WriterId, { end: string; root: string }[]>()
  for (const [end, writers] of readingAt) {
    const root = rootOf(index, end)
    if (root === null) continue
    for (const w of writers) {
      const theirs = threads.get(w) ?? []
      theirs.push({ end, root })
      threads.set(w, theirs)
    }
  }
  const rank = (w: WriterId) => {
    const at = order.indexOf(w)
    return at < 0 ? order.length : at
  }
  return [...threads]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([writer, ts]) => ({ writer, threads: ts }))
}
