// host/settle — what happens between runs: each lane drained, then the
// session compacted as upkeep.

import type { LaneName, RootId } from "@pinetrie/core"
import { type Basics, failed, type HostKeeper } from "./basics.ts"

/**
 * Drain each lane given, then compact the session and sweep the images.
 * Each drain is the keeper's `once` (`drain:<lane>`), the key a card's move
 * drains by too, so a drain already waiting covers the settle's. The
 * compaction is its `later` ("compact"): it starts only when no command or
 * drain waits, so a message waiting for the lane does not wait for it, and
 * the records it compacts hold every change queued before it. Several runs
 * ending together compact once, over every root their settles named. A
 * failed drain, compaction or sweep is logged, and the rest goes on.
 */
export function createSettle(input: {
  readonly basics: Pick<Basics, "session" | "log">
  readonly keeper: HostKeeper
  readonly drain: (lane: LaneName) => Promise<void>
  /** The root a lane works in: its document is compacted with the session's. */
  readonly rootOf: (lane: LaneName) => RootId | null
  readonly compact: (roots: ReadonlySet<RootId>) => Promise<void>
  readonly sweep: () => Promise<void>
}): (lanes: readonly LaneName[]) => Promise<void> {
  const { basics, keeper } = input
  // The roots the next compaction covers: every settle's until it starts.
  // Roots added while it runs are the next one's, which their settle queued.
  let roots = new Set<RootId>()
  return lanes => {
    for (const lane of lanes) {
      const root = input.rootOf(lane)
      if (root !== null) roots.add(root)
      void keeper.once(`drain:${lane}`, () =>
        input.drain(lane).catch(failed(basics, "draining", lane)),
      )
    }
    return keeper.later("compact", async () => {
      const covered = roots
      roots = new Set()
      await input.compact(covered).catch(failed(basics, "compaction"))
      await input.sweep().catch(failed(basics, "deleting unreferenced images"))
    })
  }
}
