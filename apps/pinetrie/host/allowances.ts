// host/budgets — what agents talking spend. The budget a run spends is read
// from its prompt, never kept beside it: a relay's or an answer's names it, and
// a person's message is its own. A run spends from it only when an agent
// started it: an agent's ask, or an answer that woke its asker. A request
// spends what it adds to the talk (`addedTokens`), so each spending run's last
// request is kept here, in memory, until its end: a run resumed after a
// restart counts its first request's output alone. Its count is kept here while runs go on, and written to the budget's record when it
// crosses the limit and at each run's end, so a session write is not made for
// every model request.

import type { EntryId, ThreadId, WriterId } from "@pinetrie/core"
import {
  readLanes,
  readPlaces,
  readPromptMessage,
  readQueueHolds,
  readRecords,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  ALLOWANCE,
  type AllowanceRecord,
  addedTokens,
  decodeAnswer,
  decodeRelay,
  mayRequest,
  NONE_BLANK,
  newAllowance,
  planSpend,
  planStop,
  promptAuthor,
  type RequestTokens,
  setRecord,
} from "@pinetrie/rules"
import { cardIdOfKind } from "@pinetrie/threads"
import { type Basics, failed, type HostKeeper } from "./basics.ts"
import type { Later } from "./later.ts"
import type { Places } from "./places.ts"
import type { Records } from "./records.ts"
import type { RunDocs } from "./runs.ts"

/** The budget a run's prompt names, and whether the run spends from it. */
export interface RunAllowance {
  readonly key: EntryId
  /** An agent started the run: an agent's ask, or an answer that woke it. */
  readonly spends: boolean
  /** The person behind the chain: a new budget is theirs. */
  readonly by: WriterId | null
}

/**
 * The budget a prompt names, read from it: a relay's or an answer's, else the
 * prompt's own (a person's message, or a carry-on).
 */
export function promptAllowance(
  prompt: EntryId,
  message: unknown,
): RunAllowance {
  const relay = decodeRelay(message)
  if (relay !== undefined)
    return {
      key: relay.allowance,
      spends: relay.asker.kind === "agent",
      by: relay.by,
    }
  const answer = decodeAnswer(message)
  if (answer !== undefined)
    return { key: answer.allowance, spends: answer.wakes, by: answer.by }
  return { key: prompt, spends: false, by: promptAuthor(message) }
}

export interface Allowances {
  /** The budget `lane`'s run spends, from its prompt; null for a lane with none. */
  runAllowance(lane: ThreadId): RunAllowance | null
  /** `lane`'s budget, made when its chain has none yet, in `thread`, for `by`. */
  ensure(
    key: EntryId,
    thread: ThreadId,
    by: WriterId,
    limit?: number,
  ): Promise<AllowanceRecord>
  /** Whether `key`'s budget is spent. */
  spent(key: EntryId): boolean
  /** A model request of `lane`'s run was answered, with `tokens`. */
  onUsage(lane: ThreadId, tokens: RequestTokens): void
  /** A request outside the thread for `prompt`'s run spent `tokens`: its urgency line or digest. */
  spendFor(prompt: EntryId, tokens: number): void
  /** A request agents talking made outside every run spent `tokens` from `key`: the round's. */
  spendFrom(key: EntryId, tokens: number): void
  /** Whether `lane`'s run may make its next model request. */
  mayRequest(lane: ThreadId): boolean
  /** A run ended: its budget's count is written to its record. */
  runEnded(prompt: EntryId | null): Promise<void>
}

export function createAllowances(deps: {
  readonly basics: Pick<
    Basics,
    "session" | "places" | "live" | "now" | "newId" | "log"
  >
  /** A budget is read and spent while its run holds its root. */
  readonly runs: RunDocs
  readonly keeper: Pick<HostKeeper, "run">
  readonly records: Pick<Records, "writeValues">
  /** The writer of the places: a budget's stop is the host's change. */
  readonly placesWriter: Places
  /** A spent budget's fact is a late write. */
  readonly later: Pick<Later, "step">
  /** The settled `agents.budget`. */
  readonly limit: number
}): Allowances {
  const { session, places } = deps.basics
  const docs = deps.runs
  // The live count of each budget spent from since the host started.
  const counts = new Map<EntryId, number>()
  // Each run's budget, by its prompt, once seen: its end and its requests
  // outside the thread find it here.
  const byPrompt = new Map<EntryId, RunAllowance>()
  // Each spending run's last request, by its prompt; dropped at its end.
  const lastRequest = new Map<EntryId, RequestTokens>()

  const record = (key: EntryId): AllowanceRecord | undefined =>
    readRecords(session, ALLOWANCE).get(key)
  const countOf = (r: AllowanceRecord): number =>
    counts.get(r.message) ?? r.spent

  /** `lane`'s run: its prompt, and the budget it names. */
  function runOf(
    lane: ThreadId,
  ): { readonly prompt: EntryId; readonly budget: RunAllowance } | null {
    const doc = docs.docOf(lane)
    const prompt = doc === null ? null : readPromptMessage(doc, lane)
    if (prompt === null) return null
    const known = byPrompt.get(prompt.id)
    if (known !== undefined) return { prompt: prompt.id, budget: known }
    const budget = promptAllowance(prompt.id, prompt.message)
    byPrompt.set(prompt.id, budget)
    return { prompt: prompt.id, budget }
  }

  const runAllowance = (lane: ThreadId): RunAllowance | null =>
    runOf(lane)?.budget ?? null

  /**
   * The record crossed its limit: written, and its thread told. The record is
   * the budget's own count, written whatever became of its thread, so a
   * restored canvas's agents cannot spend it again; telling the thread is a
   * late write, since a round's request can cross it after its run ended.
   */
  function wentOver(over: AllowanceRecord): void {
    const failed = (error: unknown) =>
      deps.basics.log(`[host] a spent allowance was not recorded: ${error}`)
    void deps.keeper
      .run(() => deps.records.writeValues([setRecord(ALLOWANCE, over)]))
      .catch(failed)
    void deps.later
      .step(
        { kind: "thread", thread: over.thread },
        "a spent allowance",
        () => ({
          facts: [
            {
              kind: "allowance-spent",
              lane: over.thread,
              allowance: over.message,
              limit: over.limit,
              by: over.by,
            },
          ],
        }),
      )
      .catch(failed)
  }

  /**
   * Queue the stop's fact for a run the budget stopped: its stopper the
   * budget's person, and no queue held. pi aborts the run itself, before its
   * next request (`mayRequest`).
   */
  function stopNow(lane: ThreadId, over: AllowanceRecord): void {
    const doc = docs.docOf(lane)
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
      cards,
      holds: readQueueHolds(session),
      by: over.by,
      now: deps.basics.now(),
      id: cardIdOfKind("fact", deps.basics.newId()),
      budget: over.message,
    })
    // Synchronous, outside any keeper step: the change's body writes before
    // this returns, and only its close is left to settle.
    if (planned.kind === "abort" && planned.fact.length > 0)
      deps.placesWriter
        .change({ kind: "host" }, open => open.apply(planned.fact))
        .catch(failed(deps.basics, "a spent allowance's stop", lane))
  }

  function spend(budget: RunAllowance, tokens: number) {
    if (!budget.spends) return
    const r = record(budget.key)
    if (r === undefined) return
    const planned = planSpend(r, countOf(r), tokens)
    counts.set(r.message, planned.spent)
    if (planned.over !== null) wentOver(planned.over)
  }

  return {
    runAllowance,
    async ensure(key, thread, by, limit) {
      const known = record(key)
      if (known !== undefined) return known
      await deps.records.writeValues([
        newAllowance({ message: key, thread, by, limit: limit ?? deps.limit }),
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
      const run = runOf(lane)
      if (run === null || !run.budget.spends) return
      const previous = lastRequest.get(run.prompt) ?? null
      lastRequest.set(run.prompt, tokens)
      spend(run.budget, addedTokens(previous, tokens))
    },
    spendFor(prompt, tokens) {
      const budget = byPrompt.get(prompt)
      if (budget !== undefined) spend(budget, tokens)
    },
    spendFrom(key, tokens) {
      spend({ key, spends: true, by: null }, tokens)
    },
    mayRequest(lane) {
      const budget = runAllowance(lane)
      if (budget === null || !budget.spends) return true
      const r = record(budget.key)
      if (mayRequest(r) || r === undefined) return true
      // The run is stopped before this request: its stop is named now, while
      // the lane still runs, so its end appends it.
      stopNow(lane, r)
      return false
    },
    async runEnded(prompt) {
      if (prompt !== null) lastRequest.delete(prompt)
      const budget = prompt === null ? null : byPrompt.get(prompt)
      if (budget === null || budget === undefined || !budget.spends) return
      const r = record(budget.key)
      const count = counts.get(budget.key)
      if (r === undefined || count === undefined || count === r.spent) return
      await deps.records.writeValues([
        setRecord(ALLOWANCE, { ...r, spent: count }),
      ])
    },
  }
}
