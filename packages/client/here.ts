// client/here — who else is in the session, for the header (ADR-0030). Pure.
//
// Presence is thread-level (ADR-0024): each column of the tab a person is on
// reports the end of its thread. The header groups those by person, where
// `presenceView` groups them by thread end; "never you" is `presenceView`'s.
// The tabs' avatars are the same people turned around, by root.

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

/** Each root's readers, for the tabs' avatars: `people` turned around. */
export function readersByRoot(
  people: readonly PersonHere[],
): ReadonlyMap<string, readonly WriterId[]> {
  const readers = new Map<string, WriterId[]>()
  for (const { writer, threads } of people)
    for (const { root } of threads) {
      const at = readers.get(root) ?? []
      if (!at.includes(writer)) at.push(writer)
      readers.set(root, at)
    }
  return readers
}

/** A person in the header: here, or gone and kept while their menu is open. */
export interface PersonShown {
  readonly person: PersonHere
  readonly gone: boolean
}

/**
 * The people whose menu is open, each with where they were among those shown
 * when it opened.
 */
export type OpenMenus = ReadonlyMap<WriterId, number>

/**
 * `people`, and each person whose menu is open but who has left, put back
 * where they were, with no threads: a menu closes only when you close it.
 */
export function withOpenMenus(
  people: readonly PersonHere[],
  open: OpenMenus,
): readonly PersonShown[] {
  const shown: PersonShown[] = people.map(person => ({ person, gone: false }))
  const here = new Set(people.map(p => p.writer))
  const left = [...open]
    .filter(([writer]) => !here.has(writer))
    .sort(([, a], [, b]) => a - b)
  for (const [writer, at] of left)
    shown.splice(Math.min(at, shown.length), 0, {
      person: { writer, threads: [] },
      gone: true,
    })
  return shown
}

/** `open` after `writer`'s menu, shown at `at`, opened or closed; the same map if nothing changed. */
export function toggleOpenMenu(
  open: OpenMenus,
  writer: WriterId,
  at: number,
  isOpen: boolean,
): OpenMenus {
  if (isOpen) {
    if (open.get(writer) === at) return open
    return new Map(open).set(writer, at)
  }
  if (!open.has(writer)) return open
  const next = new Map(open)
  next.delete(writer)
  return next
}
