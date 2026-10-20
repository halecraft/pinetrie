// interface/column-status — what a column's header says its thread's last run
// needs from you. It reads the sidebar's own rule (`standingRunEnds`), so the
// line and the canvas's dot never disagree, and stays until the next run
// starts: reading past it or dismissing it only quiets it.

import type { EntryId, WriterId } from "@pinetrie/core"
import { attentionWords, type Level, type StandingRunEnd } from "./attention.ts"
import { reasonedWords } from "./signals.ts"

/** A column's status line, under its focus. */
export interface ColumnStatus {
  readonly level: Level
  /** Read past or dismissed: drawn in the header's grey, not its level's colour. */
  readonly quiet: boolean
  /** "needs you: asks whether to drop the v1 table". */
  readonly words: string
  /** Where a press brings the column: the run's last entry. */
  readonly end: EntryId
}

/** The status line for a thread's standing run-end report; null for none. */
export function columnStatus(
  standing: StandingRunEnd | undefined,
  nameOf: (writer: WriterId) => string,
): ColumnStatus | null {
  if (standing === undefined) return null
  const { record, level } = standing
  return {
    level,
    quiet: !standing.raised,
    words: reasonedWords(
      level,
      attentionWords(
        { kind: "run-end", report: record.report, ask: record.ask },
        nameOf,
      ),
    ),
    end: record.end,
  }
}
