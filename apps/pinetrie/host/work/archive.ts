// host/work/archive — what an archive or a restore does to its lanes, off the
// documents' keeper: carries out `planArchive`'s teardown, deciding nothing.
// Lanes forgotten and their containers and disks removed, a lane whose removal
// fails reported and passed; their history in the destination moved
// (`lanesMoved`), which follows each lane's proposed changes (withdrawn, or
// built again); the snapshots no one will branch from deleted in the
// background, entries' only.

import { deletableSnapshot, snapshotOwner } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import { type LaneRuntime, removeLane } from "@pinetrie/lanes"
import type { ArchiveTeardown } from "@pinetrie/rules"
import { failed, type LeaseBasics } from "../basics.ts"
import type { Destination } from "./destination.ts"
import type { LaneRegistry } from "./registry.ts"

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
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
}): Archive {
  const { basics, destination, runtime, registry, keeper } = deps
  return {
    async teardown({ forget, refs, snapshots }) {
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
      // A record's snapshot is an entry's; any other name is left, never
      // thrown over, so a teardown always finishes.
      const entries = snapshots.flatMap(s =>
        snapshotOwner(s) === "entry" ? [deletableSnapshot("entry", s)] : [],
      )
      if (entries.length > 0)
        void keeper.track(
          runtime
            .disk({ kind: "delete-snapshots", ids: entries })
            .catch(failed(basics, "deleting snapshots")),
        )
    },
  }
}
