// host/work/archive — what an archive or a restore does to its lanes, off the
// documents' keeper: carries out `planArchive`'s teardown, deciding nothing.
// Lanes forgotten and their containers and disks removed, a lane whose removal
// fails reported and passed; their history in the destination moved
// (`lanesMoved`), which follows each lane's proposed changes (withdrawn, or
// built again); the snapshots no one will branch from marked to delete, which
// the disk upkeep deletes, and a restore's lanes' marks undone.

import { type SnapshotId, snapshotOwner, type ThreadId } from "@pinetrie/core"
import { type LaneRuntime, removeLane } from "@pinetrie/lanes"
import type { ArchiveTeardown } from "@pinetrie/rules"
import { failed, type LeaseBasics } from "../basics.ts"
import type { Destination } from "./destination.ts"
import type { LaneRegistry } from "./registry.ts"

/**
 * What an archive or a restore asks of the disk upkeep, each on the
 * manager's keeper, so neither comes between an upkeep's plan and its
 * deletion. Fire and forget: the manager words what fails.
 */
export interface UpkeepAsks {
  markArchivedForDeletion(snapshots: readonly SnapshotId[]): void
  keepRestored(lanes: readonly ThreadId[]): void
}

export interface Archive {
  /** Carry out an archive's or a restore's teardown (`planArchive`). */
  teardown(teardown: ArchiveTeardown): Promise<void>
}

export function createArchive(deps: {
  readonly basics: LeaseBasics
  /** Where lanes' work goes when lanes have their own copies, else null. */
  readonly destination: Pick<Destination, "lanesMoved"> | null
  /** What lanes run on. */
  readonly runtime: LaneRuntime
  readonly registry: LaneRegistry
  readonly upkeep: UpkeepAsks
}): Archive {
  const { basics, destination, runtime, registry } = deps
  return {
    async teardown({ forget, refs, snapshots, restored }) {
      // One lane's disk that will not go is waste; a teardown stopped there
      // would strand every lane after it, its history and its snapshots.
      for (const lane of forget) {
        await registry.forget(lane)
        await removeLane(runtime, lane).catch(
          failed(basics, "removing an archived lane", lane),
        )
      }
      if (destination !== null && refs.length > 0)
        await destination
          .lanesMoved(refs)
          .catch(failed(basics, "moving archived or restored lanes' history"))
      // A record's snapshot is an entry's; any other name is left.
      const entries = snapshots.filter(s => snapshotOwner(s) === "entry")
      if (entries.length > 0) deps.upkeep.markArchivedForDeletion(entries)
      if (restored.length > 0) deps.upkeep.keepRestored(restored)
    },
  }
}
