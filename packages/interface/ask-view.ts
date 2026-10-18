// interface/ask-view — each ask's segments grouped, so one component draws an
// ask's work, and the words and facts that work is drawn with.

import {
  type AskIndex,
  askOutcome,
  askSpan,
  type DigestBody,
  type DigestRecord,
  type EntryId,
  entryAsk,
  entryMessage,
  firstLine,
  lastWord,
  type RevisionRecord,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { askStats, type Segment } from "./ask-segments.ts"
import { outcomeWords, workWords } from "./ask-words.ts"
import { callLabel } from "./tool-words.ts"

/** A column's messages as drawn: one on its own, or an ask's work together. */
export type ColumnRow =
  | { readonly kind: "message"; readonly id: EntryId }
  | {
      readonly kind: "ask"
      readonly ask: EntryId
      /**
       * Its segments on this path, in order: folds, landmarks, its last word,
       * and any message steered in among them.
       */
      readonly parts: readonly [Segment, ...Segment[]]
    }

/**
 * `segments` grouped: an ask's work is one row, a message steered into its
 * run included (`entryAsk`), and its prompt and everything else a row each.
 */
export function columnRows(
  segments: readonly Segment[],
  asks: AskIndex,
): readonly ColumnRow[] {
  const rows: ColumnRow[] = []
  for (const s of segments) {
    const ask = s.kind === "fold" ? s.ask : entryAsk(asks, s.id)
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

/**
 * The column's last ask whose run has ended: outline keeps its last word.
 * The running ask is passed over, so a new run leaves the reply
 * before it in place until it ends itself.
 */
export function lastEndedAsk(
  rows: readonly ColumnRow[],
  runningAsk: EntryId | null,
): EntryId | null {
  const row = rows.findLast(r => r.kind === "ask" && r.ask !== runningAsk)
  return row?.kind === "ask" ? row.ask : null
}

/**
 * What an ask's work is drawn with. Its words are drawn only through
 * `planAskWork` (`ask-fold.ts`), which says each once.
 */
export interface AskView {
  readonly ask: EntryId
  readonly running: boolean
  /** Its run ended after the reader left the column's end (`releasedTip`). */
  readonly endedWhileAway: boolean
  /** What its work holds (`workWords`). */
  readonly work: string
  /** How it ended, when that needs saying (`outcomeWords`). */
  readonly outcome: string | null
  /** While it runs, what it is doing: its running command, else its latest text. */
  readonly live: string | null
  /**
   * What outline folds with its work: its last word (`lastWord`), unless it
   * is the column's last ended ask.
   */
  readonly outlineHides: EntryId | null
  /** Its model-written digest, live or final; a live one's points are none. */
  readonly digest: DigestBody | null
  /** How many files its turns changed, for a review: none without a span to read (`askSpan`). */
  readonly files: number
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
  const message = newest === undefined ? null : entryMessage(index, newest)
  const call = message?.toolCalls?.at(-1)
  if (call !== undefined && asks.last.get(ask) === newest)
    return callLabel(call, "cut")
  for (const id of work.toReversed()) {
    const line = firstLine(entryMessage(index, id)?.text ?? "", LIVE_LINE)
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
  /** The column's last ended ask (`lastEndedAsk`). */
  readonly lastEnded: EntryId | null
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  /** The column's path up to `releasedTip`; null while it follows its end. */
  readonly releasedPath: ReadonlySet<EntryId> | null
  readonly nameOf: (writer: WriterId) => string
}): AskView {
  const { index, asks, ask } = input
  const running = input.runningAsk === ask
  const outcome = askOutcome(index, asks, ask, { running })
  const last = asks.last.get(ask)
  const stats = askStats(index, asks, ask, input.revisions)
  const digest = input.digests.get(ask)
  return {
    ask,
    running,
    endedWhileAway:
      !running &&
      input.releasedPath !== null &&
      last !== undefined &&
      !input.releasedPath.has(last),
    work: workWords(stats, input.nameOf),
    outcome: outcomeWords(outcome, input.nameOf),
    live: running ? liveLine(index, asks, ask) : null,
    outlineHides: input.lastEnded === ask ? null : lastWord(index, asks, ask),
    digest:
      digest === undefined
        ? null
        : {
            headline: digest.headline,
            points: digest.final ? digest.points : [],
          },
    files:
      askSpan(index, asks, ask, input.revisions) === null
        ? 0
        : stats.files.length,
  }
}
