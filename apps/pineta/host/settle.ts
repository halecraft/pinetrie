// host/settle — what happens between runs, as one serial step.

import type { LaneName, RootId } from "@pineta/core"
import { type Basics, failed } from "./basics.ts"
import type { Serial } from "./queue.ts"

/**
 * Drain each lane given, then compact the session and sweep the images.
 * Draining first means a message waiting for the lane does not wait for the
 * compaction; a run it starts streams while the session compacts. A run's
 * end is when the session's op log has grown most and its streams have just
 * closed. A compaction queued and not yet started absorbs the next request:
 * several runs ending together compact once. A failed drain, compaction or
 * sweep is logged, and the step goes on: the other lanes still drain, and the
 * session still compacts.
 */
export function createSettle(input: {
  readonly basics: Pick<Basics, "session" | "log">
  readonly serial: Serial
  readonly drain: (lane: LaneName) => Promise<void>
  /** The root a lane works in: its document is compacted with the session's. */
  readonly rootOf: (lane: LaneName) => RootId | null
  readonly compact: (roots: ReadonlySet<RootId>) => Promise<void>
  /** Before compacting: what must be written first (the directory's refreshes). */
  readonly beforeCompact: () => Promise<void>
  readonly sweep: () => Promise<void>
}): (lanes: readonly LaneName[]) => Promise<void> {
  const { basics, serial } = input
  let compactionQueued = false
  // The roots the queued compaction covers: those of every settle it absorbed.
  let roots = new Set<RootId>()
  return lanes => {
    const compact = !compactionQueued
    compactionQueued = true
    for (const lane of lanes) {
      const root = input.rootOf(lane)
      if (root !== null) roots.add(root)
    }
    return serial.run(async () => {
      for (const lane of lanes)
        await input.drain(lane).catch(failed(basics, "draining", lane))
      if (!compact) return
      compactionQueued = false
      const covered = roots
      roots = new Set()
      await input
        .beforeCompact()
        .then(() => input.compact(covered))
        .catch(failed(basics, "compaction"))
      await input.sweep().catch(failed(basics, "deleting unreferenced images"))
    })
  }
}
