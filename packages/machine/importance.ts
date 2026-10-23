// machine/importance — which lanes matter most when memory is short: the
// order rung 3 keeps lanes calling in, and held starts are let go in.

import type { ThreadId } from "@pinetrie/core"

/** What the host knows of one lane that bears on how much it matters now. */
export interface LaneImportance {
  readonly lane: ThreadId
  /** Someone has a column open on its thread. */
  readonly isRead: boolean
  /** Its run's start among the host's, higher the later; null for none since the host started. */
  readonly startOrder: number | null
  /** Its thread's queue is held: its run will not go on to a next message. */
  readonly isQueueHeld: boolean
}

/**
 * The lanes, most important first: one someone reads, then the latest run
 * started, then one whose queue is not held, then by id. Total, so no tie
 * rests on the order `lanes` came in.
 */
export function rankLanes(
  lanes: readonly LaneImportance[],
): readonly ThreadId[] {
  return [...lanes]
    .sort(
      (a, b) =>
        Number(b.isRead) - Number(a.isRead) ||
        (b.startOrder ?? -1) - (a.startOrder ?? -1) ||
        Number(a.isQueueHeld) - Number(b.isQueueHeld) ||
        (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0),
    )
    .map(l => l.lane)
}
