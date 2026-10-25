// conflict-ask — a lane's agent's ask about a conflict in its copy, named by
// the run that asked: what turns its proposed changes to "needs you" until
// the lane's next run ends. A session record, so the page judges every lane
// alike, whether or not it holds the lane's tree.

import {
  type EntryId,
  entryId,
  type ThreadId,
  type ValueWrite,
} from "@pinetrie/core"
import { Type } from "typebox"
import { recordDecoder, threadKey } from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"
import type { RunEndReportRecord } from "./run-end-report.ts"

const ConflictAskSchema = Type.Object({ run: Type.String({ minLength: 1 }) })

/** A lane's newest ask about a conflict, keyed by its lane. */
export interface ConflictAskRecord {
  readonly lane: ThreadId
  /** The prompt of the run that asked: the run-end report's `ask` once it ends. */
  readonly run: EntryId
}

export const CONFLICT_ASK: RecordSpec<
  ConflictAskRecord,
  ThreadId,
  "session",
  typeof ConflictAskSchema
> = {
  namespace: "pinetrie.conflict-ask",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: recordDecoder(ConflictAskSchema, threadKey, (r, lane) => ({
    lane,
    run: entryId(r.run),
  })),
}

/** What an `ask_about_conflict` call comes to. */
interface ConflictAskPlan {
  /** The person is asked: the lane's copy has a conflict to ask about. */
  readonly asked: boolean
  readonly writes: readonly ValueWrite<"session">[]
}

/**
 * An ask is taken only while the lane's copy is conflicted (`conflicts`, from
 * its history); one taken is recorded with `run`, the asking run's prompt.
 */
export const planConflictAsk = (
  lane: ThreadId,
  conflicts: readonly string[],
  run: EntryId,
): ConflictAskPlan =>
  conflicts.length === 0
    ? { asked: false, writes: [] }
    : { asked: true, writes: [setRecord(CONFLICT_ASK, { lane, run })] }

/**
 * The lanes whose agent still waits on its question: its ask names the run
 * the lane's run-end report names. While that run runs, the report is the
 * run before's, and the strip reads `running` anyway; the next run's end
 * replaces the report, which ends the ask. A lane with no report is not
 * asking.
 */
export function askingLanes(
  asks: ReadonlyMap<ThreadId, ConflictAskRecord>,
  reports: ReadonlyMap<ThreadId, RunEndReportRecord>,
): ReadonlySet<ThreadId> {
  return new Set(
    [...asks.values()]
      .filter(a => reports.get(a.lane)?.ask === a.run)
      .map(a => a.lane),
  )
}
