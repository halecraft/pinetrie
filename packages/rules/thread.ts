// thread — a thread's record (ADR-0117): its root, who started it and when,
// and a copy's fork until it writes. Where a thread starts and ends is the
// tree's (`starts`, `threadEnd` in @pinetrie/core), never a record's.

import {
  ancestry,
  type EntryId,
  entryId,
  isRootId,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, threadKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const ThreadRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  createdAt: Type.Number(),
  fork: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

/** Each thread, at its id, in the session: written with its first message. */
export const THREAD: RecordSpec<ThreadRecord, ThreadId, "session"> = {
  namespace: "pinetrie.thread",
  home: "session",
  keyOf: r => r.thread,
  encode: ({ thread, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(ThreadRecordSchema, contents, threadKey(key), (r, thread) =>
      isRootId(r.root)
        ? {
            thread,
            root: r.root,
            by: r.by as WriterId,
            createdAt: r.createdAt,
            fork: r.fork === null ? null : entryId(r.fork),
          }
        : undefined,
    ),
}

/** A lane as `deriveThreads` reads it: its tip, and when it was created. */
export interface LaneTip {
  readonly lane: ThreadId
  readonly tip: EntryId | null
  readonly createdAt: number
}

/**
 * Each thread's first entry in a tree written before a thread's first
 * message named it (ADR-0117), and the thread's id. Pure; what the one-time
 * migration that names them reads (`0004-threads`).
 *
 * - An entry with no parent, or whose parent the tree lacks, starts a thread.
 * - A lane's tip ends its thread: every child of it was a branch (ADR-0021).
 * - Elsewhere, of an entry's children, the one on the path to the tip of the
 *   oldest lane through them continues the thread; with no lane through
 *   them, the oldest child. Every other child starts a thread.
 * - A thread ending at a lane's tip takes that lane's name as its id (the
 *   oldest lane's, should two end there); any other takes `mint()`.
 *
 * The guess only decides which column reads as a branch's parent: a lane's
 * thread is anchored by its lane, wherever its tip is.
 */
export function deriveThreads(
  index: TreeIndex,
  lanes: readonly LaneTip[],
  mint: () => ThreadId,
): ReadonlyMap<EntryId, ThreadId> {
  const oldestFirst = lanes
    .filter(l => l.tip !== null && index.entries[l.tip] !== undefined)
    .toSorted((a, b) => a.createdAt - b.createdAt)
  // The oldest lane through each entry, and the oldest lane at each tip.
  const through = new Map<EntryId, LaneTip>()
  const atTip = new Map<EntryId, LaneTip>()
  for (const lane of oldestFirst) {
    if (lane.tip === null) continue
    if (!atTip.has(lane.tip)) atTip.set(lane.tip, lane)
    for (const id of ancestry(index, lane.tip).path)
      if (!through.has(id)) through.set(id, lane)
  }
  const continuation = (id: EntryId): EntryId | undefined => {
    if (atTip.has(id)) return undefined
    const children = index.childrenOf.get(id) ?? []
    let best: EntryId | undefined
    for (const c of children) {
      const lane = through.get(c)
      if (lane === undefined) continue
      const now = best === undefined ? undefined : through.get(best)
      if (now === undefined || lane.createdAt < now.createdAt) best = c
    }
    return best ?? children[0]
  }
  const firsts: EntryId[] = [...index.roots, ...index.orphans]
  for (const id of Object.keys(index.entries) as EntryId[]) {
    const next = continuation(id)
    for (const c of index.childrenOf.get(id) ?? [])
      if (c !== next) firsts.push(c)
  }
  const out = new Map<EntryId, ThreadId>()
  for (const first of firsts.toSorted()) {
    let end = first
    const seen = new Set<EntryId>([first])
    for (
      let next = continuation(end);
      next !== undefined && !seen.has(next);
      next = continuation(end)
    ) {
      seen.add(next)
      end = next
    }
    out.set(first, atTip.get(end)?.lane ?? mint())
  }
  return out
}
