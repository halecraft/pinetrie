// core/fixtures — test support for core's unit tests: entries and trees,
// their ids minted with `entryId`. Production code never imports it, and the
// package does not export it.

import { type EntryId, entryId } from "./index.ts"
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
 * id: a user's message whose text is its id, unless given.
 */
export const fromParents = (
  parents: Record<string, string | null>,
  message: (id: string) => AgentMessageLike = id => ({
    role: "user",
    content: id,
  }),
): Record<EntryId, EntryLike> =>
  entriesOf(
    Object.entries(parents).map(([id, parentId]) =>
      entry(id, parentId, message(id)),
    ),
  )
