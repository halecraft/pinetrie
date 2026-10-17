// interface/here — who else is in the session, for the board and the sidebar.
//
// Presence is thread-level: each column of the canvas a person is on reports
// the end of its thread. `peopleHere` groups those by person, where
// `othersReading` groups them by thread end; "never you" is `othersReading`'s.

import {
  type CanvasId,
  type EntryId,
  entryThread,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"

interface PersonHere {
  readonly writer: WriterId
  /** Each thread end they read, with its canvas. */
  readonly threads: readonly {
    readonly end: EntryId
    readonly canvas: CanvasId
  }[]
}

/**
 * `othersReading` (thread end -> the others there, you left out)
 * grouped by person, in `order` (`writerOrder`, so every window agrees).
 * An end's canvas is its thread's (`entryThread`, `canvasOfThread`), else what its
 * reader reported (`readReadingCanvases`), for a root this window does not
 * hold. An end with neither, not arrived yet, is left out.
 */
export function peopleHere(
  othersReading: ReadonlyMap<EntryId, readonly WriterId[]>,
  index: TreeIndex,
  order: readonly WriterId[],
  facts: {
    readonly canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
    readonly reported: ReadonlyMap<EntryId, CanvasId>
  },
): readonly PersonHere[] {
  const threads = new Map<WriterId, { end: EntryId; canvas: CanvasId }[]>()
  for (const [end, writers] of othersReading) {
    const thread = entryThread(index, end)
    const canvas =
      (thread === null ? undefined : facts.canvasOfThread.get(thread)) ??
      facts.reported.get(end)
    if (canvas === undefined) continue
    for (const w of writers) {
      const theirs = threads.get(w) ?? []
      theirs.push({ end, canvas })
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
 * The people reading in `canvases`, each with only their threads there: a
 * board item's readers, or a board state's. A person reading
 * elsewhere only is left out.
 */
export function peopleIn(
  people: readonly PersonHere[],
  canvases: ReadonlySet<CanvasId>,
): readonly PersonHere[] {
  return people.flatMap(p => {
    const threads = p.threads.filter(t => canvases.has(t.canvas))
    return threads.length === 0 ? [] : [{ ...p, threads }]
  })
}

/** Each canvas's readers, for the sidebar's avatars: `people` turned around. */
export function readersByCanvas(
  people: readonly PersonHere[],
): ReadonlyMap<CanvasId, readonly WriterId[]> {
  const readers = new Map<CanvasId, WriterId[]>()
  for (const { writer, threads } of people)
    for (const { canvas } of threads) {
      const at = readers.get(canvas) ?? []
      if (!at.includes(writer)) at.push(writer)
      readers.set(canvas, at)
    }
  return readers
}

/** A person shown on the board: here, or gone and kept while their menu is open. */
interface PersonShown {
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
