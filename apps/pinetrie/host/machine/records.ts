// host/machine/records — what the disk upkeep reads of the host's
// documents: every root's revision records' entry snapshots, for the
// index's fill, and which lanes will run again.

import {
  type RevisionRecord,
  type RootId,
  snapshotOwner,
  type ThreadId,
} from "@pinetrie/core"
import type { RecordedSnapshot, StoreRecords } from "@pinetrie/machine"
import { readLaneRecords, readRevisions, readRoots } from "@pinetrie/reads"
import type { LeaseBasics } from "../basics.ts"
import { isLaneArchived } from "../canvases.ts"
import type { MachineReach } from "../work/runtime.ts"

/** The paths a record says its turn changed, those its disk lists among them: what its snapshot's cost follows. */
export function recordedChange(r: RevisionRecord): number {
  const d = r.disk
  return (
    r.paths.length +
    (d === null
      ? 0
      : d.derived.paths.length +
        d.derived.more +
        d.private.paths.length +
        d.private.more +
        d.unignored.length +
        d.leftovers.length)
  )
}

/** A root's records' entry snapshots, as the index's fill writes them. */
export const recordedSnapshots = (
  records: Iterable<RevisionRecord>,
): readonly RecordedSnapshot[] =>
  [...records].flatMap(r =>
    r.snapshot === null || snapshotOwner(r.snapshot) !== "entry"
      ? []
      : [{ snapshot: r.snapshot, lane: r.lane, changed: recordedChange(r) }],
  )

export function createStoreRecords(deps: {
  readonly basics: LeaseBasics
  readonly reach: Pick<MachineReach, "runningLanes">
}): StoreRecords {
  const { basics } = deps
  const { session } = basics
  const isArchived = (lane: ThreadId) =>
    isLaneArchived({ places: basics.places, session }, lane)
  return {
    roots: async () => [...readRoots(session).keys()],
    async snapshotsOf(root) {
      await using held = basics.leases.root(root as RootId)
      const doc = await held.ready
      return recordedSnapshots(readRevisions(doc).values())
    },
    liveLanes: async () =>
      new Set(
        [...readLaneRecords(session).keys()].filter(lane => !isArchived(lane)),
      ),
    runningLanes: async () =>
      new Set((await deps.reach.runningLanes()).map(r => r.lane)),
  }
}
