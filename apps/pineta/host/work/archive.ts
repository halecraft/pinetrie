// host/work/archive — a root archived or restored (ADR-0029): its lanes'
// disks deleted, their history out of your repo and their offers withdrawn,
// and its document let go from memory (ADR-0063); or all of it back.

import { type LaneName, nearestRevision, type RootId } from "@pineta/core"
import {
  type DiskPaths,
  laneContainer,
  removeLane,
  removeSnapshots,
} from "@pineta/lanes"
import { planRetention } from "@pineta/marginalia"
import { readLaneRecords, readRevisions, readTreeIndex } from "@pineta/reads"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"
import { type Basics, failed } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { Serial } from "../queue.ts"
import type { LaneRegistry } from "./registry.ts"

/** The lanes of their own that work in `root`, from their records. */
const lanesIn = (session: SessionDocHandle, root: RootId): LaneName[] =>
  [...readLaneRecords(session).values()]
    .filter(r => r.root === root && r.work?.kind === "own")
    .map(r => r.lane)

export interface Archive {
  /**
   * A root was archived: its lanes' disks, bookmarks and offers go, then its
   * document leaves memory. It stays in the store, and a client's request
   * loads it again.
   */
  archived(root: RootId): Promise<void>
  /** A root was restored: its document is opened, and its lanes' bookmarks and offers come back. */
  restored(root: RootId): Promise<void>
}

export function createArchive(deps: {
  readonly basics: Basics
  /** Your repo's offers when lanes have their own copies, else null. */
  readonly offers: Pick<Offers, "moveLanes"> | null
  readonly paths: DiskPaths | null
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly serial: Serial
}): Archive {
  const { basics, offers, paths, registry, serial } = deps
  const { session, docs } = basics
  return {
    async archived(archivedRoot) {
      if (offers === null || paths === null) {
        await docs.unload(archivedRoot)
        return
      }
      const doc = await docs.root(archivedRoot)
      const lanes = lanesIn(session, archivedRoot)
      for (const lane of lanes) {
        await registry.forget(lane)
        await removeLane(laneContainer(lane))
      }
      // Their history leaves your repo: readable by id, out of every log.
      await offers
        .moveLanes(lanes.map(lane => ({ lane, commit: null })))
        .catch(failed(basics, "deleting archived lanes' history"))
      const inRoot = new Set<string>(lanes)
      const doomed = planRetention({
        records: [...readRevisions(doc).values()].filter(r =>
          inRoot.has(r.lane),
        ),
        archived: true,
      })
      void serial.track(
        removeSnapshots(paths, doomed).catch(
          failed(basics, "deleting snapshots"),
        ),
      )
      await docs.unload(archivedRoot)
    },

    async restored(restoredRoot) {
      const doc = await docs.root(restoredRoot)
      if (offers === null) return
      const index = readTreeIndex(doc)
      const revisions = readRevisions(doc)
      const updates = lanesIn(session, restoredRoot).flatMap(lane => {
        const tip = readLaneTip(doc, lane)
        if (tip === null) return []
        const { commit } = nearestRevision(index, revisions, {
          kind: "entry",
          id: tip,
        })
        return commit === null ? [] : [{ lane, commit }]
      })
      await offers
        .moveLanes(updates)
        .catch(failed(basics, "restoring lanes' history"))
    },
  }
}
