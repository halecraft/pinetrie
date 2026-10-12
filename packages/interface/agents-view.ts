// interface/agents-view — other threads' agents in a column's header: the
// thread's members, those out of reach marked away, and what agents talking
// from its messages have spent.

import type {
  EntryId,
  Reach,
  ThreadId,
  ThreadName,
  WriterId,
} from "@pinetrie/core"
import { awayWords, type BudgetRecord, tokensWords } from "@pinetrie/rules"

/** What a column's header says of other threads' agents. */
export interface AgentsRow {
  /** The thread's members, by name, in the order invited; why one is away. */
  readonly members: readonly {
    readonly name: string
    readonly away: string | null
  }[]
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
 * the last of this thread's is shown. A member is away exactly when it is
 * not in `inReach` (`reachableAgents`), so `threadReach` is read for those alone,
 * to say why.
 */
export function agentsRow(input: {
  readonly thread: ThreadId
  readonly members: readonly ThreadId[]
  readonly inReach: ReadonlySet<ThreadId>
  readonly threadReach: (thread: ThreadId) => Reach
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly nameOf: (w: WriterId) => string
  readonly budgets: ReadonlyMap<EntryId, BudgetRecord>
}): AgentsRow | null {
  const members = input.members.map(t => {
    const name = input.names.get(t) ?? t.slice(-8)
    if (input.inReach.has(t)) return { name, away: null }
    const reach = input.threadReach(t)
    return {
      name,
      away: reach.kind === "open" ? null : awayWords(reach, input.nameOf),
    }
  })
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
  const named = row.members.map(m =>
    m.away === null ? m.name : `${m.name} (${m.away})`,
  )
  const with_ = named.length === 0 ? null : `with ${named.join(", ")}`
  const { budget } = row
  const spent =
    budget === null
      ? null
      : budget.over
        ? `agents spent the budget of ${tokensWords(budget.limit)}`
        : `agents spent ${tokensWords(budget.spent).replace(/ tokens$/, "")} of ${tokensWords(budget.limit)}`
  return [with_, spent].filter(w => w !== null).join(" · ")
}
