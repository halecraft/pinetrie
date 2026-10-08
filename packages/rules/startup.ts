// startup — what a starting host does with the lanes it finds, pure.

import type { CardRecord, ThreadId, VerdictRecord } from "@pinetrie/core"
import { queuedOn } from "./card.ts"

/**
 * What a starting host runs, pure. A lane a crash interrupted holds its
 * operation open, so it is resumed before anything queued for it (S36 item
 * 18), and its run's end drains it. Every other lane with cards queued for
 * it is drained, since no run's end will. A verdict left pending lost its
 * request with the last host, and is `unclassified`, unless its lane is
 * resumed, whose run's end writes another (ADR-0077). What does not survive
 * a process (runs, streams) is cleared first (`planClear`, `live.ts`).
 */
export function planStartup(input: {
  readonly cards: readonly CardRecord[]
  /** Lanes a crash interrupted, as pi reports them. */
  readonly interrupted: readonly ThreadId[]
  readonly verdicts: readonly VerdictRecord[]
}): {
  readonly resume: readonly ThreadId[]
  readonly drain: readonly ThreadId[]
  readonly unclassified: readonly VerdictRecord[]
} {
  const resume = [...new Set(input.interrupted)]
  const lanes = new Set<ThreadId>()
  for (const c of input.cards)
    if (c.place.kind === "queued") lanes.add(c.place.lane)
  const drain = [...lanes]
    .filter(lane => queuedOn(input.cards, lane).length > 0)
    .filter(lane => !resume.includes(lane))
  const unclassified = input.verdicts
    .filter(v => v.verdict.kind === "pending" && !resume.includes(v.lane))
    .map(v => ({ ...v, verdict: { kind: "unclassified" } as const }))
  return { resume, drain, unclassified }
}
