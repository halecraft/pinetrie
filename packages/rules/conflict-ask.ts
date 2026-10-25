// conflict-ask — when a lane's agent last asked the person about a conflict
// in its copy: what turns its proposed changes to "needs you". A session
// record, so the page judges every lane alike, whether or not it holds the
// lane's tree.

import type { ThreadId, ValueWrite } from "@pinetrie/core"
import { Type } from "typebox"
import { recordDecoder, threadKey } from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"

const ConflictAskSchema = Type.Object({ at: Type.Number() })

/** A lane's newest ask about a conflict, keyed by its lane. */
export interface ConflictAskRecord {
  readonly lane: ThreadId
  /** When the host took it, in ms since the epoch. */
  readonly at: number
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
    at: r.at,
  })),
}

/** What an `ask_about_conflict` call comes to. */
interface ConflictAskPlan {
  /** The person is asked: the lane's copy has a conflict to ask about. */
  readonly asked: boolean
  readonly writes: readonly ValueWrite<"session">[]
}

/**
 * An ask stands only while the lane's copy is conflicted (`conflicts`, from
 * its history); one that stands is recorded at `now`.
 */
export const planConflictAsk = (
  lane: ThreadId,
  conflicts: readonly string[],
  now: number,
): ConflictAskPlan =>
  conflicts.length === 0
    ? { asked: false, writes: [] }
    : { asked: true, writes: [setRecord(CONFLICT_ASK, { lane, at: now })] }
