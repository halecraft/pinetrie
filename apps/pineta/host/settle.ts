// host/settle — what happens between runs, as one serial step.

import type { LaneName } from "@pineta/core"
import { type Basics, failed } from "./basics.ts"
import type { Serial } from "./queue.ts"

/**
 * Drain each lane given, then compact the session and sweep the images.
 * Draining first means a message waiting for the lane does not wait for the
 * compaction; a run it starts streams while the session compacts. A run's
 * end is when the session's op log has grown most and its streams have just
 * closed. A compaction queued and not yet started absorbs the next request:
 * several runs ending together compact once. A failed compaction or sweep is
 * logged, and the host carries on.
 */
export function createSettle(input: {
  readonly basics: Pick<Basics, "doc" | "log">
  readonly serial: Serial
  readonly drain: (lane: LaneName) => Promise<void>
  readonly compact: () => Promise<void>
  readonly sweep: () => Promise<void>
}): (lanes: readonly LaneName[]) => Promise<void> {
  const { basics, serial } = input
  let compactionQueued = false
  return lanes => {
    const compact = !compactionQueued
    compactionQueued = true
    return serial.run(async () => {
      for (const lane of lanes) await input.drain(lane)
      if (!compact) return
      compactionQueued = false
      try {
        await input.compact()
      } catch (error) {
        failed(basics, "compaction")(error)
      }
      try {
        await input.sweep()
      } catch (error) {
        failed(basics, "deleting unreferenced images")(error)
      }
    })
  }
}
