// client/ask-view — what a column draws of each ask (ADR-0056). Pure.
//
// `segmentPath` (core) decides what folds; this groups each ask's segments
// so one component draws an ask's work, and decides the words and facts that
// work is drawn with.

import {
  type AskIndex,
  askOutcome,
  askSpan,
  askStats,
  type DiffSpan,
  type EntryId,
  firstLine,
  lastWord,
  messageAt,
  type RevisionRecord,
  type Segment,
  type StopRecord,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { outcomeWords, workWords } from "./ask-words.ts"

/** A column's messages as drawn: one on its own, or an ask's work together. */
export type ColumnRow =
  | { readonly kind: "message"; readonly id: EntryId }
  | {
      readonly kind: "ask"
      readonly ask: EntryId
      /** Its segments on this path, in order: folds, landmarks, its last word. */
      readonly parts: readonly [Segment, ...Segment[]]
    }

const askOfSegment = (s: Segment, asks: AskIndex): EntryId | undefined =>
  s.kind === "fold" ? s.ask : asks.askOf.get(s.id)

/**
 * `segments` grouped: a run of segments that one ask's run wrote is one row,
 * its prompt and everything else a row each. A run holds nothing anyone else
 * wrote (S21), so an ask's work is one stretch of the path.
 */
export function columnRows(
  segments: readonly Segment[],
  asks: AskIndex,
): readonly ColumnRow[] {
  const rows: ColumnRow[] = []
  for (const s of segments) {
    const ask = askOfSegment(s, asks)
    if (ask === undefined) {
      if (s.kind === "entry") rows.push({ kind: "message", id: s.id })
      continue
    }
    const last = rows.at(-1)
    if (last?.kind === "ask" && last.ask === ask)
      rows[rows.length - 1] = { ...last, parts: [...last.parts, s] }
    else rows.push({ kind: "ask", ask, parts: [s] })
  }
  return rows
}

/** What an ask's work is drawn with. */
export interface AskView {
  readonly ask: EntryId
  readonly running: boolean
  /** Its run ended after the reader left the column's end (`releasedTip`). */
  readonly endedWhileAway: boolean
  /** What its work holds (`workWords`). */
  readonly digest: string
  /** How it ended, when that needs saying (`outcomeWords`). */
  readonly outcome: string | null
  /** While it runs, what it is doing: its running command, else its latest text. */
  readonly live: string | null
  /** Its last word (`lastWord`): hidden in outline. */
  readonly lastWord: EntryId | null
  /** Its model-written digest, when digests are on (ADR-0056). */
  readonly summary: string | null
  /** How many files its turns changed, and the span a review of them reads. */
  readonly files: number
  readonly span: DiffSpan | null
}

/** How long a live line is shown. */
const LIVE_LINE = 80

/**
 * What it does now: the call its newest message made, while no result has
 * come after it; else the first line of its newest text.
 */
function liveLine(
  index: TreeIndex,
  asks: AskIndex,
  ask: EntryId,
): string | null {
  const work = asks.work.get(ask) ?? []
  const newest = work.at(-1)
  const message = newest === undefined ? null : messageAt(index, newest)
  const call = message?.toolCalls?.at(-1)
  if (call !== undefined && asks.last.get(ask) === newest) return call.label
  for (const id of work.toReversed()) {
    const line = firstLine(messageAt(index, id)?.text ?? "", LIVE_LINE)
    if (line !== "") return line
  }
  return null
}

export function askView(input: {
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly ask: EntryId
  /** The prompt of the ask this column's lane is running, if any. */
  readonly runningAsk: EntryId | null
  readonly stops: ReadonlyMap<EntryId, StopRecord>
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  readonly digests: ReadonlyMap<EntryId, { readonly text: string }>
  /** The column's path up to `releasedTip`; null while it follows its end. */
  readonly releasedPath: ReadonlySet<EntryId> | null
  readonly nameOf: (writer: WriterId) => string
}): AskView {
  const { index, asks, ask } = input
  const running = input.runningAsk === ask
  const outcome = askOutcome(index, asks, ask, {
    running,
    stop: input.stops.get(ask),
  })
  const last = asks.last.get(ask)
  const stats = askStats(index, asks, ask, input.revisions)
  return {
    ask,
    running,
    endedWhileAway:
      !running &&
      input.releasedPath !== null &&
      last !== undefined &&
      !input.releasedPath.has(last),
    digest: workWords(stats, input.nameOf),
    outcome: outcomeWords(outcome, input.nameOf),
    live: running ? liveLine(index, asks, ask) : null,
    lastWord: lastWord(index, asks, ask),
    summary: input.digests.get(ask)?.text ?? null,
    files: stats.files.length,
    span: askSpan(index, asks, ask, input.revisions),
  }
}
