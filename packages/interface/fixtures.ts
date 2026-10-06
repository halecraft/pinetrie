// interface/fixtures — test support for the interface's unit tests and the
// page's: entries and trees, their ids minted with `entryId`. Production code
// never imports it; the page's tests take it as `@pinetrie/interface/fixtures`.

import {
  type AgentMessageLike,
  type EntryId,
  type EntryLike,
  entryId,
  indexTree,
  rootIdFor,
  type TreeIndex,
} from "@pinetrie/core"

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

/** The index of `list`, keyed by each entry's own id as the reads key them. */
export const indexOf = (list: Iterable<EntryLike>): TreeIndex =>
  indexTree(entriesOf(list))

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

/**
 * A tree of chat messages from `child: parent` pairs, each message's text its
 * id; `sends` gives some entries a send id.
 */
export const tree = (
  parents: Record<string, string | null>,
  sends: Record<string, string> = {},
): TreeIndex =>
  indexOf(
    Object.entries(parents).map(([id, parentId]) =>
      entry(id, parentId, {
        role: "chat",
        content: id,
        ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
      }),
    ),
  )

/** The root a test's places and entries are in (ADR-0063). */
export const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root a new tab minted as it opened (ADR-0066), in the shape the host accepts. */
export const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
