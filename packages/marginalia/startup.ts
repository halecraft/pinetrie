// startup — what a starting host does with the lanes it finds, pure.

import type { CardRecord, LaneName } from "@pineta/core"
import { queuedOn } from "./card.ts"

/**
 * What a starting host runs, pure. A lane a crash interrupted holds its
 * operation open, so it is resumed before anything queued for it (S36 item
 * 18), and its run's end drains it. Every other lane with cards queued for
 * it is drained, since no run's end will. What does not survive a process
 * (runs, streams) is cleared first, by `clearStreams` in `@pineta/schema`.
 */
export function planStartup(input: {
  readonly cards: readonly CardRecord[]
  /** Lanes a crash interrupted, as pi reports them. */
  readonly interrupted: readonly LaneName[]
}): {
  readonly resume: readonly LaneName[]
  readonly drain: readonly LaneName[]
} {
  const resume = [...new Set(input.interrupted)]
  const lanes = new Set<LaneName>()
  for (const c of input.cards)
    if (c.place.kind === "queued") lanes.add(c.place.lane)
  const drain = [...lanes]
    .filter(lane => queuedOn(input.cards, lane).length > 0)
    .filter(lane => !resume.includes(lane))
  return { resume, drain }
}
