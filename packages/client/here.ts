// client/here — who else is in the session, for the header (ADR-0030). Pure.
//
// Presence is thread-level (ADR-0024): each column of the tab a person is on
// reports the end of its thread. The header groups those by person, where
// `readingAt` groups them by thread end; "never you" is `readingAt`'s.
// The tabs' avatars are the same people turned around, by root.

import {
  type AgentRun,
  type EntryId,
  type LaneName,
  type RootId,
  type RootRecord,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"

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

/** A lane the agent is replying on, for the header: its root, and where to open it. */
export interface RunHere {
  readonly lane: LaneName
  /** Its root entry. */
  readonly root: EntryId
  /** Its tip, in a root this tab holds; else its root entry. */
  readonly end: EntryId
}

/**
 * Every lane the agent is replying on, in any root (ADR-0063): each held
 * lane's run (`activity`), at its tip, then each other lane `running`
 * names, at its root's entry from the directory. A lane whose root has no
 * entry yet is left out.
 */
export function runsHere(input: {
  readonly activity: readonly AgentRun[]
  readonly running: readonly {
    readonly lane: LaneName
    readonly root: RootId
  }[]
  readonly directory: ReadonlyMap<RootId, RootRecord>
  readonly index: TreeIndex
}): readonly RunHere[] {
  const out: RunHere[] = []
  for (const { lane, tip } of input.activity) {
    const root = rootOf(input.index, tip)
    if (root !== null) out.push({ lane, root, end: tip })
  }
  const held = new Set(out.map(r => r.lane))
  for (const { lane, root } of input.running) {
    const entry = input.directory.get(root)?.entry ?? null
    if (!held.has(lane) && entry !== null)
      out.push({ lane, root: entry, end: entry })
  }
  return out
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
