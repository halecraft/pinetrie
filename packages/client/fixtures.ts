// client/fixtures — test support for the client's unit tests: entries and
// trees, their ids minted with `entryId`. Production code never imports it.

import {
  type AgentMessageLike,
  type EntryId,
  type EntryLike,
  entryId,
  indexTree,
  rootIdFor,
  type TreeIndex,
} from "@pineta/core"

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

/** The index of `list`, keyed by each entry's own id as the reads key them. */
export const indexOf = (list: Iterable<EntryLike>): TreeIndex => {
  const entries: Record<EntryId, EntryLike> = {}
  for (const e of list) entries[e.id] = e
  return indexTree(entries)
}

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
