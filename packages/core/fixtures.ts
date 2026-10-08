// core/fixtures — test support: entries and trees, their ids minted with
// `entryId`. Core's tests use it, and other packages' tests as
// `@pinetrie/core/fixtures`; production code never imports it.

import { type EntryId, entryId, type ThreadId, threadIdFor } from "./index.ts"
import type { AgentMessageLike, EntryLike } from "./tree.ts"

/** One entry: a message when `message` is given, else of `more.type`. */
export const entry = (
  id: string,
  parentId: string | null,
  message?: AgentMessageLike,
  more: { readonly type?: string; readonly timestamp?: number } = {},
): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  type: more.type ?? "message",
  ...(message === undefined ? {} : { message }),
  ...(more.timestamp === undefined ? {} : { timestamp: more.timestamp }),
})

/** Entries keyed by their own ids, as the reads key them. */
export const entriesOf = (
  list: Iterable<EntryLike>,
): Record<EntryId, EntryLike> => {
  const out: Record<EntryId, EntryLike> = {}
  for (const e of list) out[e.id] = e
  return out
}

/**
 * Entries from `child: parent` pairs, each a message `message` makes from its
 * id: a user's message whose text is its id, unless given; each thread's
 * first message marked (`withThreads`).
 */
export const fromParents = (
  parents: Record<string, string | null>,
  message: (id: string) => AgentMessageLike = id => ({
    role: "user",
    content: id,
  }),
): Record<EntryId, EntryLike> =>
  withThreads(
    entriesOf(
      Object.entries(parents).map(([id, parentId]) =>
        entry(id, parentId, message(id)),
      ),
    ),
  )

/** The thread a fixture's entry `id` starts, when it starts one (`withThreads`). */
export const threadOfEntry = (id: string): ThreadId => threadIdFor(id)

/**
 * `entries` with each thread's first message marked (`starts`, ADR-0117), as
 * a branch's first message is: every entry with no parent, and every child
 * but an entry's oldest, starts the thread `threadOfEntry(its id)`. Left as
 * they are when any entry is marked already: the test chose its threads.
 */
export const withThreads = (
  entries: Record<EntryId, EntryLike>,
): Record<EntryId, EntryLike> => {
  const list = Object.values(entries)
  if (list.some(e => e.message?.starts !== undefined)) return entries
  const children = new Map<string, EntryId[]>()
  for (const e of list)
    if (e.parentId !== null && entries[e.parentId] !== undefined)
      children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.id])
  const continues = new Set<EntryId>()
  for (const ids of children.values()) {
    const oldest = ids.toSorted()[0]
    if (oldest !== undefined) continues.add(oldest)
  }
  return entriesOf(
    list.map(e =>
      continues.has(e.id) || e.message === undefined
        ? e
        : { ...e, message: { ...e.message, starts: threadOfEntry(e.id) } },
    ),
  )
}
