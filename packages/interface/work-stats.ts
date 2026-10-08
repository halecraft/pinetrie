// interface/work-stats — what some messages hold: a stretch on the rail, or
// an ask's work in a column, counted alike. Pure.

import {
  type EntryId,
  messageAt,
  type RevisionRecord,
  resultsOn,
  type ToolCall,
  type TreeIndex,
  type WriterId,
  writersOf,
} from "@pinetrie/core"

/**
 * What some messages hold: a stretch on the rail, or an ask's work in a
 * column. A long ask's stretch and its fold hold the same messages, so they
 * count the same.
 */
export interface WorkStats {
  /** Messages people wrote: every role but `assistant`. */
  readonly people: number
  /** Who wrote them, in order of first message. */
  readonly writers: readonly WriterId[]
  /** The agent's messages. */
  readonly agent: number
  /** Tool calls in its messages, and how many of them failed. */
  readonly calls: number
  readonly failed: number
  /** Paths its turns changed, from their revision records, sorted. */
  readonly files: readonly string[]
  /** Its first and last entries' timestamps, results included; 0 when unknown. */
  readonly first: number
  readonly last: number
}

/**
 * What `ids`' messages hold, consecutive on one path. Their tool results are
 * between them: below each, up to the next one, or `after` for the last.
 */
export function workStats(
  index: TreeIndex,
  ids: readonly EntryId[],
  after: EntryId | undefined,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  const between: EntryId[] = []
  for (const [k, id] of ids.entries()) {
    const next = ids[k + 1] ?? after
    if (next === undefined) continue
    for (
      let at = index.parentOf(next);
      at !== null && at !== id;
      at = index.parentOf(at)
    )
      between.push(at)
  }
  return statsOf(index, ids, between, revisions)
}

/**
 * What `messages` hold, with `others`, the entries among them that are no
 * message (tool results), for their failures and their times. Files are the
 * paths the messages' turns' revision records name.
 */
export function statsOf(
  index: TreeIndex,
  messages: readonly EntryId[],
  others: readonly EntryId[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  let people = 0
  const calls: ToolCall[] = []
  const files = new Set<string>()
  const times: number[] = []
  for (const id of [...messages, ...others]) {
    const t = index.entries[id]?.timestamp
    if (t !== undefined) times.push(t)
  }
  for (const id of messages) {
    const message = messageAt(index, id)
    if (message?.role !== "assistant") people += 1
    calls.push(...(message?.toolCalls ?? []))
    for (const p of revisions.get(id)?.paths ?? []) files.add(p)
  }
  const results = resultsOn(index, others)
  return {
    people,
    writers: writersOf(index, messages),
    agent: messages.length - people,
    calls: calls.length,
    failed: calls.filter(c => results.get(c.id)?.isError === true).length,
    files: [...files].sort(),
    first: times.length === 0 ? 0 : Math.min(...times),
    last: times.length === 0 ? 0 : Math.max(...times),
  }
}
