// host/work/archive — a root archived or restored (ADR-0029): its lanes'
// disks deleted, their history out of your repo and their offers withdrawn,
// or both back.

import { nearestRevision, rootOf } from "@pineta/core"
import {
  type DiskPaths,
  laneContainer,
  removeLane,
  removeSnapshots,
} from "@pineta/lanes"
import { planRetention } from "@pineta/marginalia"
import { readLaneRecords, readRevisions, readTreeIndex } from "@pineta/reads"
import {
  readLaneNames,
  readLaneTip,
  type SessionDocHandle,
} from "@pineta/schema"
import { type Basics, failed } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { Serial } from "../queue.ts"
import type { LaneRegistry } from "./registry.ts"

/** The lanes of their own whose tips are in `treeRoot`. */
function lanesIn(doc: SessionDocHandle, treeRoot: string) {
  const index = readTreeIndex(doc)
  const records = readLaneRecords(doc)
  return readLaneNames(doc).filter(lane => {
    const tip = readLaneTip(doc, lane)
    return (
      tip !== null &&
      rootOf(index, tip) === treeRoot &&
      records.get(lane)?.work.kind === "own"
    )
  })
}

export interface Archive {
  /** A root was archived: its lanes' disks, bookmarks and offers go. */
  archived(root: string): Promise<void>
  /** A root was restored: its lanes' bookmarks and offers come back. */
  restored(root: string): Promise<void>
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
  const { doc } = basics
  return {
    async archived(archivedRoot) {
      if (offers === null || paths === null) return
      const lanes = lanesIn(doc, archivedRoot)
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
    },

    async restored(restoredRoot) {
      if (offers === null) return
      const index = readTreeIndex(doc)
      const revisions = readRevisions(doc)
      const updates = lanesIn(doc, restoredRoot).flatMap(lane => {
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
