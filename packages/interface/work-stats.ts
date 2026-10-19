// interface/work-stats — what some messages hold: a stretch on the rail, or
// an ask's work in a column, counted alike.

import type { EntryId, RevisionRecord, WriterId } from "@pinetrie/core"
import {
  entryMessage,
  messageWriters,
  resultsOn,
  type ToolCall,
  type TreeIndex,
  transcriptCalls,
} from "@pinetrie/threads"

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
  /**
   * Local files its turns wrote, from their records: each record's topmost
   * paths and how many more it counted.
   */
  readonly private: number
  /** Directories its runs made from source that `.gitignore` does not ignore. */
  readonly unignored: number
  /** Source files its turns wrote that their commits left out. */
  readonly leftovers: number
  /** Its writes to shared files based on a version another write had replaced. */
  readonly concurrent: number
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
  return entriesWorkStats(index, ids, between, revisions)
}

/**
 * What `messages` hold, with `others`, the entries among them that are no
 * message (tool results), for their failures and their times. Files are the
 * paths the messages' turns' revision records name.
 */
export function entriesWorkStats(
  index: TreeIndex,
  messages: readonly EntryId[],
  others: readonly EntryId[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  let people = 0
  const calls: ToolCall[] = []
  const files = new Set<string>()
  const priv = new Set<string>()
  let privateMore = 0
  const unignored = new Set<string>()
  const leftovers = new Set<string>()
  let concurrent = 0
  const times: number[] = []
  for (const id of [...messages, ...others]) {
    const t = index.entries[id]?.timestamp
    if (t !== undefined) times.push(t)
  }
  for (const id of messages) {
    const message = entryMessage(index, id)
    if (message?.role !== "assistant") people += 1
    if (message !== null) calls.push(...transcriptCalls(message))
    const record = revisions.get(id)
    for (const p of record?.paths ?? []) files.add(p)
    const disk = record?.disk ?? null
    for (const p of disk?.private.paths ?? []) priv.add(p)
    privateMore += disk?.private.more ?? 0
    for (const p of disk?.unignored ?? []) unignored.add(p)
    for (const p of disk?.leftovers ?? []) leftovers.add(p)
    concurrent += (disk?.shared.wrote ?? []).filter(w => w.concurrent).length
  }
  const results = resultsOn(index, others)
  return {
    people,
    writers: messageWriters(index, messages),
    agent: messages.length - people,
    calls: calls.length,
    failed: calls.filter(c => results.get(c.id)?.isError === true).length,
    files: [...files].sort(),
    private: priv.size + privateMore,
    unignored: unignored.size,
    leftovers: leftovers.size,
    concurrent,
    first: times.length === 0 ? 0 : Math.min(...times),
    last: times.length === 0 ? 0 : Math.max(...times),
  }
}
