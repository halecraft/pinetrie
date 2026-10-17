// core/proposals — where an agent's proposal of branches stands: running,
// ready to press, or spent, read from the tree and the thread records. The
// page and the host read it alike, so the buttons and the host's refusals
// agree.

import { type AskIndex, entryAsk } from "./asks.ts"
import type { EntryId, ThreadId, ThreadRecord, WriterId } from "./index.ts"
import type { TreeIndex } from "./tree.ts"

/** A branch opened from a proposal, as its record names it. */
export interface ProposedThread {
  readonly thread: ThreadId
  readonly row: number
  /** Who pressed: the thread record's `by`. */
  readonly by: WriterId
}

/**
 * Each proposal's branches, by the proposal's entry, in row order. One pass
 * over the records, so a reader memoises it rather than scanning per proposal.
 */
export function branchesByProposal(
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
): ReadonlyMap<EntryId, readonly ProposedThread[]> {
  const out = new Map<EntryId, ProposedThread[]>()
  for (const r of threads.values()) {
    const { origin } = r
    if (origin.kind !== "fork" || origin.how !== "branch") continue
    const { proposal } = origin
    if (proposal === undefined) continue
    const branch = { thread: r.thread, row: proposal.row, by: r.by }
    const known = out.get(proposal.entry)
    if (known === undefined) out.set(proposal.entry, [branch])
    else known.push(branch)
  }
  for (const list of out.values()) list.sort((a, b) => a.row - b.row)
  return out
}

/** Where a proposal stands. */
export type ProposalState =
  /** Its own run has not ended. */
  | { readonly kind: "running" }
  | { readonly kind: "ready"; readonly fork: EntryId }
  /** Someone pressed Start or Open: it is never pressed again. */
  | {
      readonly kind: "spent"
      readonly by: WriterId
      readonly fork: EntryId
      readonly threads: readonly {
        readonly thread: ThreadId
        readonly row: number
        readonly started: boolean
      }[]
    }

/**
 * Where the proposal at `proposal` stands; null when that entry holds none.
 * It forks at its run's last entry, a tool result included when a Stop left
 * one last: a reply after a Stop goes there too, and the message before it
 * may hold a call that would then have no result.
 */
export function proposalState(input: {
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly branches: ReadonlyMap<EntryId, readonly ProposedThread[]>
  readonly proposal: EntryId
  /** The prompt of the run the proposing lane runs now, if any. */
  readonly runningAsk: EntryId | null
}): ProposalState | null {
  const { index, asks, proposal } = input
  if (index.entries[proposal]?.message?.proposal === undefined) return null
  const prompt = entryAsk(asks, proposal)
  if (prompt === undefined) return null
  const fork = asks.last.get(prompt)
  if (fork === undefined) return null
  const opened = input.branches.get(proposal)
  const first = opened?.[0]
  if (opened !== undefined && first !== undefined)
    return {
      kind: "spent",
      by: first.by,
      fork,
      threads: opened.map(b => ({
        thread: b.thread,
        row: b.row,
        started: index.firstOf.has(b.thread),
      })),
    }
  return input.runningAsk === prompt
    ? { kind: "running" }
    : { kind: "ready", fork }
}
