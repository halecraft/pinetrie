// host/machine/importance — what the host knows of its lanes that bears on
// which matters most when memory is short, gathered for `rankLanes`: who
// reads each lane's thread, the order runs started in, and which queues are
// held.

import type { RootId, ThreadId } from "@pinetrie/core"
import { type LaneImportance, rankLanes } from "@pinetrie/machine"
import { readQueueHolds, readReading, readTreeIndex } from "@pinetrie/reads"
import type { PresenceDocHandle } from "@pinetrie/schema"
import { entryThread } from "@pinetrie/threads"
import type { LeaseBasics } from "../basics.ts"

/** The order runs start in on this host: a count, never a clock. */
export interface RunStarts {
  /** A run on `lane` is starting. */
  noteRunStarted(lane: ThreadId): void
  /** Where `lane`'s latest run start falls, higher the later; null for none since the host started. */
  startOrder(lane: ThreadId): number | null
}

export function createRunStarts(): RunStarts {
  let count = 0
  const order = new Map<ThreadId, number>()
  return {
    noteRunStarted(lane) {
      order.set(lane, ++count)
    },
    startOrder: lane => order.get(lane) ?? null,
  }
}

/**
 * `lanes`, most important first. A lane is read when a column's thread end
 * is in its thread, read from its root's tree, leased for the read: its
 * run holds it loaded.
 */
export async function gatherLaneImportance(
  deps: {
    readonly basics: LeaseBasics
    readonly presence: PresenceDocHandle
    readonly runStarts: Pick<RunStarts, "startOrder">
  },
  lanes: readonly ThreadId[],
): Promise<readonly ThreadId[]> {
  const { basics, presence, runStarts } = deps
  // gather
  const ends = readReading(presence).map(([, end]) => end)
  const holds = readQueueHolds(basics.session)
  const roots = new Map<RootId, ThreadId[]>()
  for (const lane of lanes) {
    const root = basics.docs.rootOfLane(lane)
    if (root !== null) roots.set(root, [...(roots.get(root) ?? []), lane])
  }
  const read = new Set<ThreadId>()
  for (const root of roots.keys()) {
    await using held = basics.leases.root(root)
    const index = readTreeIndex(await held.ready)
    for (const end of ends) {
      const thread = entryThread(index, end)
      if (thread !== null) read.add(thread)
    }
  }
  // plan
  const facts = lanes.map(
    (lane): LaneImportance => ({
      lane,
      isRead: read.has(lane),
      startOrder: runStarts.startOrder(lane),
      isQueueHeld: holds.has(lane),
    }),
  )
  return rankLanes(facts)
}
