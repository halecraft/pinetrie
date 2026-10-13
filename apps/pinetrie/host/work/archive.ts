// host/work/archive — what an archive or a restore does to its lanes, off the
// documents' keeper: carries out `planArchive`'s teardown, deciding nothing.
// Lanes forgotten and their containers and disks removed, a lane whose
// removal fails reported and passed; their refs in your
// repo moved by an owner command, which marks each lane's offer (withdrawn, or
// built again); the snapshots no one will branch from deleted in the
// background.

import type { Keeper } from "@pinetrie/keeper"
import { type LaneRuntime, removeLane } from "@pinetrie/lanes"
import type { ArchiveTeardown } from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { LaneRegistry } from "./registry.ts"

export interface Archive {
  /** Carry out an archive's or a restore's teardown (`planArchive`). */
  teardown(teardown: ArchiveTeardown): Promise<void>
}

export function createArchive(deps: {
  readonly basics: Basics
  /** Your repo's offers when lanes have their own copies, else null. */
  readonly offers: Pick<Offers, "moveLanes"> | null
  /** What lanes run on. */
  readonly runtime: LaneRuntime
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
}): Archive {
  const { basics, offers, runtime, registry, keeper } = deps
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
      if (offers !== null && refs.length > 0)
        await offers
          .moveLanes(refs)
          .catch(failed(basics, "moving archived or restored lanes' history"))
      if (snapshots.length > 0)
        void keeper.track(
          runtime
            .disk({ kind: "deleteSnapshots", ids: snapshots })
            .catch(failed(basics, "deleting snapshots")),
        )
    },
  }
}
