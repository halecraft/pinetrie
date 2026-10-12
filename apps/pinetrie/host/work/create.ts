// host/work/create — a new lane: where it works, its record and name, and, for
// a lane of its own, its fork from where it branched, or from accepted work or
// a WIP's copy where nothing is above.

import {
  BASE_SNAPSHOT,
  type ErrCode,
  type ForkStart,
  nearestRevision,
  type Position,
  type SnapshotId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import {
  executeOrThrow,
  planFork,
  removeLane,
  revsetName,
} from "@pinetrie/lanes"
import { type RootView, readRevisions, readTreeIndex } from "@pinetrie/reads"
import { beginFacts, type RepoOwner } from "@pinetrie/repo"
import {
  FILES_LOST,
  type ForkBegin,
  forkPoint,
  LANE,
  planBegin,
  setRecord,
} from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Ready, Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/**
 * What a fork is planned from: the revision nearest above where it branched,
 * and where agent work begins with none above (accepted work, or a WIP's copy).
 * Read only once every turn record being written has been, so a branch at a
 * turn whose snapshot is still running gets that turn's disk.
 */
export async function forkFacts(ports: {
  readonly pendingRecords: Turns["pendingRecords"]
  readonly nearest: () => ReturnType<typeof nearestRevision>
  readonly begin: () => Promise<ForkBegin | ErrCode>
  /** Whether a snapshot is still there: archiving deletes some. */
  readonly exists: (snapshot: SnapshotId) => Promise<boolean>
}): Promise<Parameters<typeof forkPoint>[0] | ErrCode> {
  await ports.pendingRecords()
  const above = ports.nearest()
  const begin = await ports.begin()
  if (typeof begin === "string") return begin
  const kept =
    above.snapshot === null ||
    above.snapshot === BASE_SNAPSHOT ||
    (await ports.exists(above.snapshot))
  return { above, begin, kept }
}

export interface NewLanes {
  /**
   * Whether a new lane can begin at `at` from `base` (a WIP bookmark, null for
   * accepted work), checked before the lane is made: null, or why not. A lane
   * with agent work above inherits it, and needs neither.
   */
  checkBegin(
    view: RootView,
    at: Position,
    base: string | null,
  ): Promise<ErrCode | null>
  /** Record a new lane in its root, name it, and queue its fork. */
  prepareLane(
    view: RootView,
    lane: ThreadId,
    at: Position,
    by: WriterId,
    base: string | null,
  ): Promise<void>
}

/**
 * A new lane's record, written as it is made, and its name: every lane has
 * both, a host without tools' too.
 */
export async function recordLane(
  deps: {
    readonly basics: Pick<Basics, "now">
    readonly records: Pick<Records, "writeValues">
    readonly ensureNames: () => Promise<void>
  },
  view: Pick<RootView, "root">,
  lane: ThreadId,
  ownCopy: boolean,
  by: WriterId,
): Promise<void> {
  await deps.records.writeValues([
    setRecord(LANE, {
      lane,
      root: view.root,
      ownCopy,
      by,
      createdAt: deps.basics.now(),
    }),
  ])
  await deps.ensureNames()
}

export function createNewLanes(deps: {
  readonly basics: Basics
  readonly setup: Setup
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly records: Pick<Records, "writeValues">
  readonly ensureNames: () => Promise<void>
  readonly pendingRecords: Turns["pendingRecords"]
}): NewLanes {
  const { basics, setup, registry, keeper } = deps

  const { repoConfig } = setup.lanes

  /**
   * Where a fork from a WIP's copy starts: the base disk holds accepted work's
   * dependencies, so a WIP whose recipe's inputs differ from accepted work's
   * starts from a dependency layer of its own, made at its commit if missing.
   * Any other fork starts where its point says.
   */
  async function startSnapshot(
    owner: RepoOwner,
    point: { readonly snapshot: SnapshotId; readonly start: ForkStart },
    r: Ready,
  ): Promise<SnapshotId> {
    const { start } = point
    if (point.snapshot !== BASE_SNAPSHOT || start.kind !== "wip")
      return point.snapshot
    const keys = await owner.read(async ({ jj }) => ({
      wip: await setup.keyAt(jj, start.commit, r),
      accepted: await setup.keyAt(
        jj,
        `present(${revsetName(repoConfig.acceptedBookmark)})`,
        r,
      ),
    }))
    return keys.wip === keys.accepted
      ? point.snapshot
      : setup.depsLayerAt([start.commit], keys.wip)
  }

  /** Where agent work begins for `base`, read from your repo at the head its owner last observed. */
  async function beginAt(owner: RepoOwner, base: string | null) {
    return planBegin({
      base,
      wipPrefix: repoConfig.wipPrefix,
      facts: await owner.read(({ jj }) => beginFacts(jj, repoConfig, base)),
    })
  }

  return {
    async checkBegin(view, at, base) {
      const { owner } = setup
      const { doc } = view
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      if (above.commit !== null) return null
      const begin = await beginAt(owner, base)
      return typeof begin === "string" ? begin : null
    },

    async prepareLane(view, lane, at, by, base) {
      const { doc } = view
      await recordLane(deps, view, lane, true, by)
      const { owner, runtime, ready } = setup
      const handle = registry.handleOf(lane)
      void keeper.track(
        handle.queue
          .enqueue(
            async () => {
              const r = await ready
              const facts = await forkFacts({
                pendingRecords: deps.pendingRecords,
                nearest: () =>
                  nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
                begin: () => beginAt(owner, base),
                exists: id => runtime.snapshotExists(id),
              })
              if (typeof facts === "string")
                throw new Error(`the lane cannot begin: ${facts}`)
              const point = forkPoint(facts)
              // Its fork row says it began from its base.
              if (point.lost !== null)
                await deps.records.writeValues([
                  setRecord(FILES_LOST, { lane, snapshot: point.lost }),
                ])
              if (point.snapshot === BASE_SNAPSHOT) await setup.baseAtAccepted()
              const from = await startSnapshot(owner, point, r)
              await removeLane(runtime, lane)
              await executeOrThrow(
                planFork({
                  point: { ...point, snapshot: from },
                  spec: setup.specOf(lane, r),
                  env: process.env,
                }),
                handle.runners,
              )
              // The fork's `run` made it, and started it.
              await handle.start("running")
            },
            { fatal: true },
          )
          .catch(failed(basics, "forking", lane)),
      )
    },
  }
}
