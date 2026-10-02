// core/asks — an ask is a message that started a run, with that run
// (ADR-0056). Derived from the tree, never stored.
//
// A run's entries are the agent's messages and their tool results below its
// prompt (`startsRun`), up to the next prompt. A lane is never written while
// it runs (S21), so nothing a person wrote sits inside a run.
//
// The column folds each ask's work (`segmentPath`), and the rail compacts the
// same stretches (`compactRail`): both draw `railLandmarks` apart, so a fold
// never hides what the rail draws on its own.

import {
  atEntry,
  type DiffSpan,
  type EntryId,
  entryId,
  type RevisionRecord,
  type StopRecord,
  type WriterId,
} from "./index.ts"
import {
  type EntryLike,
  messageText,
  startsRun,
  statsOf,
  type TreeIndex,
  type WorkStats,
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
}

/** How an ask's run ended, or that it has not. */
export type AskOutcome =
  | { readonly kind: "running" }
  | { readonly kind: "answered" }
  /**
   * Every abort S70 measured was a Stop: a restart resumes the run. `by` is
   * null for a stop made before stops were recorded.
   */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  | { readonly kind: "failed"; readonly error: string }

/** What a column draws, in order: an entry as itself, or part of an ask's work folded. */
export type Segment =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "fold"
      readonly ask: EntryId
      readonly ids: readonly [EntryId, ...EntryId[]]
      /** The ask's first fold on this path: where its digest is drawn. */
      readonly first: boolean
    }

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
  const promptAt = new Map<string, EntryId | null>()
  const resolve = (from: string): EntryId | null => {
    const walked: string[] = []
    let found: EntryId | null = null
    for (let id: string | null = from; id !== null; id = index.parentOf(id)) {
      const seen = promptAt.get(id)
      if (seen !== undefined) {
        found = seen
        break
      }
      walked.push(id)
      if (startsRun(index.entries[id])) {
        found = entryId(id)
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
  // Ids are uuidv7, so sorted ids are creation order (S9).
  for (const id of Object.keys(index.entries).sort()) {
    const entry = index.entries[id]
    if (!isWork(entry)) continue
    const parent = index.parentOf(id)
    const prompt = parent === null ? null : resolve(parent)
    if (prompt === null) continue
    const eid = entryId(id)
    askOf.set(eid, prompt)
    last.set(prompt, eid)
    if (entry?.message?.role === "assistant")
      work.set(prompt, [...(work.get(prompt) ?? []), eid])
  }
  const asks: AskIndex = { askOf, work, last }
  known.set(index, asks)
  return asks
}

/**
 * How `prompt`'s run ended, from its last entries (S70): an assistant
 * message that `aborted` was stopped, and so was a run whose last entry is a
 * tool result, since only a Stop ends a run before the model reads a result;
 * one with `error` failed; anything else answered. A stop record names who
 * stopped it, and is ignored when the run answered anyway.
 */
export function askOutcome(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  facts: { readonly running: boolean; readonly stop: StopRecord | undefined },
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
    ? { kind: "stopped", by: facts.stop?.by ?? null }
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
 * agent message with text or a tool call. A stop before the first response,
 * or a failure, leaves one with neither (S70), which is skipped; null when no
 * message has any.
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
 * A column's messages, `ids` in path order, as the column draws them: each
 * ask's work folded, except its last word and any of `landmarks`
 * (`railLandmarks`), which split the fold around them. A prompt, a message
 * no run wrote, and a landmark are drawn as themselves.
 *
 * So a column's segment edges are the landmarks and every ask's edges, and
 * the rail's stretch edges are the landmarks and long asks' edges: every
 * edge the rail draws is one here.
 */
export function segmentPath(
  index: TreeIndex,
  asks: AskIndex,
  ids: readonly string[],
  landmarks: ReadonlySet<string>,
): readonly Segment[] {
  const out: Segment[] = []
  const words = new Map<EntryId, EntryId | null>()
  const wordOf = (prompt: EntryId) => {
    if (!words.has(prompt)) words.set(prompt, lastWord(index, asks, prompt))
    return words.get(prompt)
  }
  const folded = new Set<EntryId>()
  for (const raw of ids) {
    const id = entryId(raw)
    const ask = asks.askOf.get(id)
    if (ask === undefined || landmarks.has(id) || wordOf(ask) === id) {
      out.push({ kind: "entry", id })
      continue
    }
    const before = out.at(-1)
    if (before?.kind === "fold" && before.ask === ask) {
      out[out.length - 1] = { ...before, ids: [...before.ids, id] }
      continue
    }
    out.push({ kind: "fold", ask, ids: [id], first: !folded.has(ask) })
    folded.add(ask)
  }
  return out
}

/**
 * What an ask's work holds (`statsOf`): every agent message and tool result
 * its run wrote, wherever its column shows them. A long ask's capsule counts
 * the same messages (`compactRail`).
 */
export function askStats(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  revisions: ReadonlyMap<string, RevisionRecord>,
): WorkStats {
  const work = asks.work.get(prompt) ?? []
  const mine = new Set<string>(work)
  const results = [...asks.askOf]
    .filter(([id, ask]) => ask === prompt && !mine.has(id))
    .map(([id]) => id)
  return statsOf(index, work, results, revisions)
}

/**
 * An ask's files as a span: from the commit its prompt's record names, what
 * the lane had before it (`planTurnRecord`), to the nearest commit at its
 * run's last entry (`nearestRevision`). Null when they are the same, or a
 * lane working directly records none.
 */
export function askSpan(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  revisions: ReadonlyMap<string, RevisionRecord>,
): DiffSpan | null {
  const from = revisions.get(prompt)?.commit ?? null
  const last = asks.last.get(prompt)
  if (from === null || last === undefined) return null
  const to = nearestRevision(index, revisions, atEntry(last)).commit
  return to === null || to === from ? null : { kind: "range", from, to }
}
