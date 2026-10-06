// interface/here — who else is in the session, for the board and your list
// (ADR-0030, ADR-0085). Pure.
//
// Presence is thread-level (ADR-0024): each column of the root a person is on
// reports the end of its thread. `peopleHere` groups those by person, where
// `readingAt` groups them by thread end; "never you" is `readingAt`'s. A
// board item's readers are those people in its root (`peopleIn`); your
// list's avatars are the same people turned around, by root.

import {
  type EntryId,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"

export interface PersonHere {
  readonly writer: WriterId
  /** Each thread end they read, with its root. */
  readonly threads: readonly {
    readonly end: EntryId
    readonly root: EntryId
  }[]
}

/**
 * `readingAt` (thread end -> the others there, you left out)
 * grouped by person, in `order` (`writerOrder`, so every window agrees).
 * An end's root is found in `index`, else in what its reader reported
 * (`readReadingRoots`), for a root this window does not hold (ADR-0063). An
 * end with neither, not arrived yet, is left out.
 */
export function peopleHere(
  readingAt: ReadonlyMap<EntryId, readonly WriterId[]>,
  index: TreeIndex,
  order: readonly WriterId[],
  reportedRoots: ReadonlyMap<EntryId, EntryId>,
): readonly PersonHere[] {
  const threads = new Map<WriterId, { end: EntryId; root: EntryId }[]>()
  for (const [end, writers] of readingAt) {
    const root = rootOf(index, end) ?? reportedRoots.get(end) ?? null
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

/** A reader's menu's heading: where they are, or that they have left. */
export const readerHeading = (name: string, gone: boolean): string =>
  gone ? `${name} has left` : `${name} is in`

/**
 * The people reading in `roots`, each with only their threads there: a board
 * item's readers, or a board state's (ADR-0085). A person reading elsewhere
 * only is left out.
 */
export function peopleIn(
  people: readonly PersonHere[],
  roots: ReadonlySet<string>,
): readonly PersonHere[] {
  return people.flatMap(p => {
    const threads = p.threads.filter(t => roots.has(t.root))
    return threads.length === 0 ? [] : [{ ...p, threads }]
  })
}

/** Each root's readers, for your list's avatars: `people` turned around. */
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

/** A person shown on the board: here, or gone and kept while their menu is open. */
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
