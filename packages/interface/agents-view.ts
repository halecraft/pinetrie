// interface/agents-view — other threads' agents in a column's header
// (ADR-0128): the thread's members, and what agents talking from its
// messages have spent. Decided here, worded once (`agentsWords`).

import type { EntryId, ThreadId, ThreadName } from "@pinetrie/core"
import { type BudgetRecord, tokensWords } from "@pinetrie/rules"

/** What a column's header says of other threads' agents. */
export interface AgentsRow {
  /** The thread's members, by name, in the order invited. */
  readonly members: readonly string[]
  /** The newest budget a message of this thread set; null for none. */
  readonly budget: {
    readonly spent: number
    readonly limit: number
    readonly over: boolean
  } | null
}

/**
 * The header's row for `thread`, or null when it has no member and no
 * budget. `budgets` is every budget, in the order the session holds them;
 * the last of this thread's is shown. Pure.
 */
export function agentsRow(input: {
  readonly thread: ThreadId
  readonly members: readonly ThreadId[]
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly budgets: ReadonlyMap<EntryId, BudgetRecord>
}): AgentsRow | null {
  const members = input.members.map(t => input.names.get(t) ?? t.slice(-8))
  const budget =
    [...input.budgets.values()].filter(b => b.thread === input.thread).at(-1) ??
    null
  if (members.length === 0 && budget === null) return null
  return {
    members,
    budget:
      budget === null
        ? null
        : { spent: budget.spent, limit: budget.limit, over: budget.over },
  }
}

/** The row in words: "with amber-fox · agents spent 38k of 200k tokens". */
export function agentsWords(row: AgentsRow): string {
  const with_ =
    row.members.length === 0 ? null : `with ${row.members.join(", ")}`
  const { budget } = row
  const spent =
    budget === null
      ? null
      : budget.over
        ? `agents spent the budget of ${tokensWords(budget.limit)}`
        : `agents spent ${tokensWords(budget.spent).replace(/ tokens$/, "")} of ${tokensWords(budget.limit)}`
  return [with_, spent].filter(w => w !== null).join(" · ")
}
