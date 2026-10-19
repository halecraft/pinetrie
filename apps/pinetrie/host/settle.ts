// host/settle — what happens between runs: each lane drained, then the upkeep.

import type { RootId, ThreadId } from "@pinetrie/core"
import { type Basics, failed, type HostKeeper } from "./basics.ts"
import type { StepDocs } from "./roots.ts"

/**
 * Drain each lane given, then the upkeep, which compacts the lanes' roots and
 * the session's documents that are due, sweeps the images, and lets go of the
 * roots nothing holds (`roots.ts`). Each drain is the keeper's `once` (`drain:<lane>`), the
 * key a card's move drains by too, so a drain already waiting covers the
 * settle's. The upkeep is its `later` ("upkeep"): it starts only when no
 * command or drain waits, so a message waiting for the lane does not wait for
 * it, and the records it compacts hold every change queued before it. Several
 * runs ending together compact once, over every root their settles named. A
 * failed drain is logged, and the rest goes on.
 */
export function createSettle(input: {
  readonly basics: Pick<Basics, "session" | "log">
  readonly keeper: Pick<HostKeeper, "once">
  readonly drain: (roots: StepDocs, lane: ThreadId) => Promise<void>
  /** The root a lane works in: the upkeep weighs compacting it with the session's documents. */
  readonly rootOf: (lane: ThreadId) => RootId | null
  /** Name the roots the next upkeep compacts, and queue it. */
  readonly settled: (roots: readonly RootId[]) => Promise<void>
}): (lanes: readonly ThreadId[]) => Promise<void> {
  const { basics, keeper } = input
  return lanes => {
    const roots: RootId[] = []
    for (const lane of lanes) {
      const root = input.rootOf(lane)
      if (root !== null) roots.push(root)
      void keeper.once(`drain:${lane}`, docs =>
        input.drain(docs, lane).catch(failed(basics, "draining", lane)),
      )
    }
    return input.settled(roots)
  }
}
