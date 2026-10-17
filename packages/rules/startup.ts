// startup — what a starting host does with the lanes it finds.

import type {
  CardRecord,
  ForeignLane,
  RunEndReportRecord,
  RunnableLane,
  ThreadId,
} from "@pinetrie/core"
import { queuedOn } from "./queue.ts"
import { unclassifiedPending } from "./run-end-report.ts"

/**
 * What a starting host runs. A lane a crash interrupted holds its operation
 * open, so it is resumed before anything queued for it, and its run's end
 * drains it. Every other lane with cards queued for it is drained, since no
 * run's end will. A run-end report left pending lost its request with the last host,
 * and is `unclassified`, unless its lane is resumed, whose run's end writes
 * another. A lane of another kind is not resumed: its run stays interrupted,
 * and resumes once the project is its kind again. What does not survive a
 * process (runs, streams) is cleared first (`planClear`, `live.ts`).
 */
export function planStartup(input: {
  readonly cards: readonly CardRecord[]
  /** Lanes a crash interrupted, as pi reports them, each proven runnable or not. */
  readonly interrupted: readonly (RunnableLane | ForeignLane)[]
  readonly runEndReports: readonly RunEndReportRecord[]
}): {
  readonly resume: readonly RunnableLane[]
  /** Interrupted lanes of another kind, left as they are. */
  readonly kept: readonly ForeignLane[]
  readonly drain: readonly ThreadId[]
  readonly unclassified: readonly RunEndReportRecord[]
} {
  const resume = [
    ...new Set(
      input.interrupted.flatMap(l => (typeof l === "object" ? [] : [l])),
    ),
  ]
  const kept = input.interrupted.flatMap(l =>
    typeof l === "object" ? [l] : [],
  )
  const lanes = new Set<ThreadId>()
  for (const c of input.cards)
    if (c.place.kind === "queued") lanes.add(c.place.thread)
  const resumed = new Set<ThreadId>(resume)
  const drain = [...lanes]
    .filter(lane => queuedOn(input.cards, lane).length > 0)
    .filter(lane => !resumed.has(lane))
  const unclassified = unclassifiedPending(
    input.runEndReports,
    lane => !resumed.has(lane),
  )
  return { resume, kept, drain, unclassified }
}
