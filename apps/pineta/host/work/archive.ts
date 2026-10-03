// host/work/archive — what an archive or a restore does to its lanes
// (ADR-0029), off the documents' keeper (ADR-0065): carries out
// `planArchive`'s teardown, deciding nothing. Lanes forgotten and their
// containers and disks removed; their refs in your repo moved by an owner
// command, which marks each lane's offer (withdrawn, or built again); the
// snapshots no one will branch from deleted in the background.

import type { Keeper } from "@pineta/keeper"
import {
  type DiskPaths,
  laneContainer,
  removeLane,
  removeSnapshots,
} from "@pineta/lanes"
import type { ArchiveTeardown } from "@pineta/marginalia"
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
  readonly paths: DiskPaths | null
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
}): Archive {
  const { basics, offers, paths, registry, keeper } = deps
  return {
    async teardown({ forget, refs, snapshots }) {
      for (const lane of forget) {
        await registry.forget(lane)
        await removeLane(laneContainer(lane))
      }
      if (offers !== null && refs.length > 0)
        await offers
          .moveLanes(refs)
          .catch(failed(basics, "moving archived or restored lanes' history"))
      if (paths !== null && snapshots.length > 0)
        void keeper.track(
          removeSnapshots(paths, snapshots).catch(
            failed(basics, "deleting snapshots"),
          ),
        )
    },
  }
}
