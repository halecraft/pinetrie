// core/asks — an ask is a message that started a run, with that run. Derived
// from the tree, never stored.
//
// A run's entries are the agent's messages and their tool results below its
// prompt (`startsRun`), up to the next prompt. A lane is never written while it
// runs, so nothing a person wrote sits inside a run: only the host's news is
// steered in (`steered`).
//
// What a column folds of each ask's work, and the rail's capsules, are the
// interface's (`segmentPath`, `compactRail`, `@pinetrie/interface`).

import {
  atEntry,
  type DiffSpan,
  type EntryId,
  type RevisionRecord,
  type WriterId,
} from "./index.ts"
import {
  type EntryLike,
  messageText,
  startsRun,
  type TreeIndex,
} from "./tree.ts"
import { nearestRevision } from "./work.ts"

/** Every run's entries, by the prompt that started it. */
export interface AskIndex {
  /** An entry of a run, its prompt excluded -> the run's prompt. */
  readonly askOf: ReadonlyMap<EntryId, EntryId>
  /**
   * A run's prompt -> its agent messages, oldest first. Tool results are not
   * messages. A prompt with none is not an ask.
   */
  readonly work: ReadonlyMap<EntryId, readonly EntryId[]>
  /** A run's prompt -> its newest entry, a tool result included. */
  readonly last: ReadonlyMap<EntryId, EntryId>
  /**
   * An entry no run wrote, steered in between a run's entries (a base's news),
   * or a stop's fact appended after them -> the run's prompt. The column draws
   * it in the ask's work and the rail in its capsule, so neither splits the ask
   * in two.
   */
  readonly steered: ReadonlyMap<EntryId, EntryId>
  /**
   * A stopped run's prompt -> who stopped it, from its stop's fact. A run
   * stopped before stops were facts names nobody.
   */
  readonly stoppedBy: ReadonlyMap<EntryId, WriterId>
}

/** The ask whose work `id` is drawn in: one its run wrote, or steered into it. */
export const entryAsk = (asks: AskIndex, id: EntryId): EntryId | undefined =>
  asks.askOf.get(id) ?? asks.steered.get(id)

/** How an ask's run ended, or that it has not. */
export type AskOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "answered" }
  /**
   * In every case measured, an aborted ending came from a Stop: a restart
   * resumes the run. `by` is null for a stop made before stops were facts, and
   * until its fact is appended, as the run ends.
   */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  | { readonly kind: "failed"; readonly error: string }

const isWork = (entry: EntryLike | undefined): boolean => {
  const role = entry?.message?.role
  return role === "assistant" || role === "toolResult"
}

const known = new WeakMap<TreeIndex, AskIndex>()

/**
 * Every ask in the tree, in one pass: each entry's nearest prompt at or above
 * it, resolved once and shared by the entries below. Kept per index, which
 * `readTreeIndex` keeps while no entry changes.
 */
export function indexAsks(index: TreeIndex): AskIndex {
  const cached = known.get(index)
  if (cached !== undefined) return cached
  const promptAt = new Map<EntryId, EntryId | null>()
  const resolve = (from: EntryId): EntryId | null => {
    const walked: EntryId[] = []
    let found: EntryId | null = null
    for (let id: EntryId | null = from; id !== null; id = index.parentOf(id)) {
      const seen = promptAt.get(id)
      if (seen !== undefined) {
        found = seen
        break
      }
      walked.push(id)
      if (startsRun(index.entries[id])) {
        found = id
        break
      }
      // A cycle has no prompt; `ancestry` reports it elsewhere.
      if (walked.length > Object.keys(index.entries).length) break
    }
    for (const id of walked) promptAt.set(id, found)
    return found
  }
  const askOf = new Map<EntryId, EntryId>()
  const work = new Map<EntryId, EntryId[]>()
  const last = new Map<EntryId, EntryId>()
  const steered = new Map<EntryId, EntryId>()
  const stoppedBy = new Map<EntryId, WriterId>()
  // Ids are uuidv7, so sorted ids are creation order.
  const entries = Object.values(index.entries).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  for (const entry of entries) {
    // A stop's fact names its ask, and is drawn in it: the first names
    // who stopped it, as the first press is the one queued.
    const stop = entry.message?.stopped
    if (stop !== undefined && index.entries[stop.prompt] !== undefined) {
      steered.set(entry.id, stop.prompt)
      if (!stoppedBy.has(stop.prompt)) stoppedBy.set(stop.prompt, stop.by)
      continue
    }
    if (!isWork(entry)) continue
    const { id } = entry
    const parent = index.parentOf(id)
    const prompt = parent === null ? null : resolve(parent)
    if (prompt === null) continue
    askOf.set(id, prompt)
    // What sits between this entry and the run's entry or prompt above it
    // was steered in. An older entry is in `askOf` already, and `resolve`
    // found no prompt nearer than `prompt`.
    for (
      let at: EntryId | null = parent;
      at !== null && at !== prompt && !askOf.has(at);
      at = index.parentOf(at)
    )
      steered.set(at, prompt)
    last.set(prompt, id)
    if (entry.message?.role === "assistant")
      work.set(prompt, [...(work.get(prompt) ?? []), id])
  }
  const asks: AskIndex = { askOf, work, last, steered, stoppedBy }
  known.set(index, asks)
  return asks
}

/**
 * The agent messages a run holds from which its ask is long. The host's rule,
 * not the rail's geometry: only a long ask is given a digest, and the rail
 * draws it as a dot and a capsule of its own.
 */
export const LONG_ASK = 3

/** A long ask: its run holds `LONG_ASK` agent messages or more. */
export const isLongAsk = (asks: AskIndex, prompt: EntryId): boolean =>
  (asks.work.get(prompt)?.length ?? 0) >= LONG_ASK

/**
 * How `prompt`'s run ended, from its last entries: an assistant message that
 * `aborted` was stopped, and so was a run whose last entry is a tool result,
 * since only a Stop ends a run before the model reads a result; one with
 * `error` failed; anything else answered. A stop's fact names who stopped it
 * (`stoppedBy`), and is ignored when the run answered anyway.
 */
export function askOutcome(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  facts: { readonly running: boolean },
): AskOutcome {
  if (facts.running) return { kind: "running" }
  const reply = asks.work.get(prompt)?.at(-1)
  const message =
    reply === undefined ? undefined : index.entries[reply]?.message
  if (message?.stopReason === "error")
    return { kind: "failed", error: message.errorMessage ?? "" }
  const lastId = asks.last.get(prompt)
  const endedOnResult =
    lastId !== undefined &&
    index.entries[lastId]?.message?.role === "toolResult"
  return message?.stopReason === "aborted" || endedOnResult
    ? { kind: "stopped", by: asks.stoppedBy.get(prompt) ?? null }
    : { kind: "answered" }
}

const hasWords = (entry: EntryLike | undefined): boolean => {
  const content = entry?.message?.content
  return (
    messageText(entry?.message).trim() !== "" ||
    (Array.isArray(content) && content.some(p => p?.type === "toolCall"))
  )
}

/**
 * The message an ask's work ends with, drawn after its fold: the run's last
 * agent message with text or a tool call. A stop before the first response, or
 * a failure, leaves one with neither, which is skipped; null when no message
 * has any.
 */
export function lastWord(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
): EntryId | null {
  return (
    asks.work.get(prompt)?.findLast(id => hasWords(index.entries[id])) ?? null
  )
}

/**
 * An ask's files as a span: from the state its prompt's record names, what
 * the lane had before it (`planTurnRecord`), to the nearest state at its
 * run's last entry (`nearestRevision`). Null when they are the same, or a
 * lane with no copy of its own records none.
 */
export function askSpan(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): DiffSpan | null {
  const from = revisions.get(prompt)?.point ?? null
  const last = asks.last.get(prompt)
  if (from === null || last === undefined) return null
  const to = nearestRevision(index, revisions, atEntry(last)).point
  return to === null || to === from ? null : { kind: "range", from, to }
}
