// host/budgets — what agents talking spend (ADR-0128). The budget a run
// spends is read from its prompt, never kept beside it: a relay's or an
// answer's names it, and a person's message is its own. A run spends from
// it only when an agent started it: an agent's ask, or an answer that woke
// its asker. Its count is kept here while runs go on, and written to the
// budget's record when it crosses the limit and at each run's end, so a
// session write is not made for every model request.

import {
  cardIdOfKind,
  type EntryId,
  indexAsks,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  readLanes,
  readPlaces,
  readPromptMessage,
  readQueueHolds,
  readRecords,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  BUDGET,
  type BudgetRecord,
  decodeAnswer,
  decodeRelay,
  mayRequest,
  NONE_BLANK,
  newBudget,
  planFactCard,
  planSpend,
  planStop,
  promptAuthor,
  setRecord,
} from "@pinetrie/rules"
import type { Basics, HostKeeper } from "./basics.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Records } from "./records.ts"

/** The budget a run's prompt names, and whether the run spends from it. */
export interface RunBudget {
  readonly key: EntryId
  /** An agent started the run: an agent's ask, or an answer that woke it. */
  readonly spends: boolean
  /** The person behind the chain: a new budget is theirs. */
  readonly by: WriterId | null
}

/**
 * The budget a prompt names (ADR-0128), read from it: a relay's or an
 * answer's, else the prompt's own (a person's message, or a carry-on). Pure
 * over the stored message.
 */
export function promptBudget(prompt: EntryId, message: unknown): RunBudget {
  const relay = decodeRelay(message)
  if (relay !== undefined)
    return {
      key: relay.budget,
      spends: relay.asker.kind === "agent",
      by: relay.by,
    }
  const answer = decodeAnswer(message)
  if (answer !== undefined)
    return { key: answer.budget, spends: answer.wakes, by: answer.by }
  return { key: prompt, spends: false, by: promptAuthor(message) }
}

export interface Budgets {
  /** The budget `lane`'s run spends, from its prompt; null for a lane with none. */
  runBudget(lane: ThreadId): RunBudget | null
  /** `lane`'s budget, made when its chain has none yet, in `thread`, for `by`. */
  ensure(
    key: EntryId,
    thread: ThreadId,
    by: WriterId,
    limit?: number,
  ): Promise<BudgetRecord>
  /** Whether `key`'s budget is spent. */
  spent(key: EntryId): boolean
  /** A model request of `lane`'s run spent `tokens` (pi's usage). */
  onUsage(lane: ThreadId, tokens: number): void
  /** A request outside the thread for `prompt`'s run spent `tokens`: its verdict or digest. */
  spendFor(prompt: EntryId, tokens: number): void
  /** A request agents talking made outside every run spent `tokens` from `key`: the round's. */
  spendFrom(key: EntryId, tokens: number): void
  /** Whether `lane`'s run may make its next model request. */
  mayRequest(lane: ThreadId): boolean
  /** A run ended: its budget's count is written to its record. */
  runEnded(prompt: EntryId | null): Promise<void>
}

export function createBudgets(deps: {
  readonly basics: Pick<
    Basics,
    "docs" | "session" | "places" | "live" | "now" | "newId" | "log"
  >
  readonly keeper: Pick<HostKeeper, "run">
  readonly records: Pick<Records, "writeValues">
  /** The user config's budget (`decodeAgentsConfig`). */
  readonly limit: number
  /** Ask for a lane's drain: a fact queued on an idle lane is appended so. */
  readonly drain: (lane: ThreadId) => void
}): Budgets {
  const { docs, session, places } = deps.basics
  // The live count of each budget spent from since the host started.
  const counts = new Map<EntryId, number>()
  // Each run's budget, by its prompt, once seen: its end and its requests
  // outside the thread find it here.
  const byPrompt = new Map<EntryId, RunBudget>()

  const record = (key: EntryId): BudgetRecord | undefined =>
    readRecords(session, BUDGET).get(key)
  const countOf = (r: BudgetRecord): number => counts.get(r.message) ?? r.spent

  function runBudget(lane: ThreadId): RunBudget | null {
    const doc = docs.docOfLane(lane)
    const prompt = doc === null ? null : readPromptMessage(doc, lane)
    if (prompt === null) return null
    const known = byPrompt.get(prompt.id)
    if (known !== undefined) return known
    const budget = promptBudget(prompt.id, prompt.message)
    byPrompt.set(prompt.id, budget)
    return budget
  }

  /** The record crossed its limit: written, and its thread told. */
  function wentOver(over: BudgetRecord): void {
    void deps.keeper
      .run(async () => {
        await deps.records.writeValues([setRecord(BUDGET, over)])
        const fact = planFactCard({
          cards: readPlaces(places),
          id: cardIdOfKind("fact", deps.basics.newId()),
          fact: {
            kind: "budget-spent",
            lane: over.thread,
            budget: over.message,
            limit: over.limit,
            by: over.by,
          },
        })
        if (fact !== null) applyPlaceSteps(places, fact)
        deps.drain(over.thread)
      })
      .catch(error =>
        deps.basics.log(`[host] a spent budget was not recorded: ${error}`),
      )
  }

  /**
   * Queue the stop's fact for a run the budget stopped (ADR-0128): its
   * stopper the budget's person, and no queue held. pi aborts the run
   * itself, before its next request (`mayRequest`).
   */
  function stopNow(lane: ThreadId, over: BudgetRecord): void {
    const doc = docs.docOfLane(lane)
    if (doc === null) return
    const index = readTreeIndex(doc)
    const cards = readPlaces(places)
    const view = readLanes(
      { doc, live: deps.basics.live },
      index,
      cards,
      readQueueHolds(session),
      NONE_BLANK,
    ).find(l => l.name === lane)
    if (view === undefined) return
    const planned = planStop(view, {
      index,
      asks: indexAsks(index),
      cards,
      holds: readQueueHolds(session),
      by: over.by,
      now: deps.basics.now(),
      id: cardIdOfKind("fact", deps.basics.newId()),
      budget: over.message,
    })
    if (planned.kind === "abort" && planned.fact.length > 0)
      applyPlaceSteps(places, planned.fact)
  }

  function spend(budget: RunBudget, tokens: number) {
    if (!budget.spends) return
    const r = record(budget.key)
    if (r === undefined) return
    const planned = planSpend(r, countOf(r), tokens)
    counts.set(r.message, planned.spent)
    if (planned.over !== null) wentOver(planned.over)
  }

  return {
    runBudget,
    async ensure(key, thread, by, limit) {
      const known = record(key)
      if (known !== undefined) return known
      await deps.records.writeValues([
        newBudget({ message: key, thread, by, limit: limit ?? deps.limit }),
      ])
      return (
        record(key) ?? {
          message: key,
          thread,
          by,
          limit: limit ?? deps.limit,
          spent: 0,
          over: false,
        }
      )
    },
    spent: key => record(key)?.over === true,
    onUsage(lane, tokens) {
      const budget = runBudget(lane)
      if (budget !== null) spend(budget, tokens)
    },
    spendFor(prompt, tokens) {
      const budget = byPrompt.get(prompt)
      if (budget !== undefined) spend(budget, tokens)
    },
    spendFrom(key, tokens) {
      spend({ key, spends: true, by: null }, tokens)
    },
    mayRequest(lane) {
      const budget = runBudget(lane)
      if (budget === null || !budget.spends) return true
      const r = record(budget.key)
      if (mayRequest(r) || r === undefined) return true
      // The run is stopped before this request: its stop is named now,
      // while the lane still runs, so its end appends it (ADR-0128).
      stopNow(lane, r)
      return false
    },
    async runEnded(prompt) {
      const budget = prompt === null ? null : byPrompt.get(prompt)
      if (budget === null || budget === undefined || !budget.spends) return
      const r = record(budget.key)
      const count = counts.get(budget.key)
      if (r === undefined || count === undefined || count === r.spent) return
      await deps.records.writeValues([
        setRecord(BUDGET, { ...r, spent: count }),
      ])
    },
  }
}
