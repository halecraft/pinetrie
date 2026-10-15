// host/work/create — a new lane: where it works, its record and name, and, for
// a lane of its own, its fork from where it branched, or from accepted work or
// a WIP's copy where nothing is above.

import {
  BASE_SNAPSHOT,
  type ErrCode,
  nearestRevision,
  type Position,
  type ProjectKind,
  type SnapshotId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import { executeOrThrow, planFork, removeLane } from "@pinetrie/lanes"
import {
  type RootView,
  readLaneRecords,
  readRevisions,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  FILES_LOST,
  type ForkBegin,
  foreignLaneWords,
  forkSource,
  LANE,
  setRecord,
  sourceHistory,
} from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import type { Destination } from "./destination.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
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
}): Promise<
  Pick<Parameters<typeof forkSource>[0], "above" | "begin" | "kept"> | ErrCode
> {
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
  /** Its own copy's kind of history; null for a host without tools. */
  history: ProjectKind | null,
  by: WriterId,
): Promise<void> {
  await deps.records.writeValues([
    setRecord(LANE, {
      lane,
      root: view.root,
      history,
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
  readonly destination: Pick<Destination, "begin">
}): NewLanes {
  const { basics, setup, registry, keeper, destination } = deps

  return {
    async checkBegin(view, at, base) {
      const { doc } = view
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      if (above.point !== null) return null
      const begin = await destination.begin(base)
      return typeof begin === "string" ? begin : null
    },

    async prepareLane(view, lane, at, by, base) {
      const { doc } = view
      const { kind } = setup.opened
      // The kind of the disk it will clone, read as if its snapshot is
      // kept: a lost one falls back to the base, the project's kind, which
      // differs only for a source of another kind, refused before a send.
      const history = sourceHistory({
        above: nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
        kept: true,
        lanes: readLaneRecords(basics.session),
        kind,
      })
      await recordLane(deps, view, lane, history, by)
      const { runtime, ready } = setup
      void keeper.track(
        registry
          .withHistory(
            lane,
            async (h, handle, record) => {
              const r = await ready
              const facts = await forkFacts({
                pendingRecords: deps.pendingRecords,
                nearest: () =>
                  nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
                begin: () => destination.begin(base),
                exists: id => runtime.snapshotExists(id),
              })
              if (typeof facts === "string")
                throw new Error(`the lane cannot begin: ${facts}`)
              const source = forkSource({
                ...facts,
                lane: record,
                lanes: readLaneRecords(basics.session),
                kind,
              })
              if (source.kind === "foreign")
                throw new Error(foreignLaneWords(source))
              // Its fork row says it began from its base.
              if (source.lost !== null)
                await deps.records.writeValues([
                  setRecord(FILES_LOST, { lane, snapshot: source.lost }),
                ])
              if (source.snapshot === BASE_SNAPSHOT)
                await setup.baseAtAccepted()
              await removeLane(runtime, lane)
              await executeOrThrow(
                planFork({
                  source,
                  spec: setup.specOf(lane, r),
                  env: process.env,
                  setup: h.forkSteps(source.start),
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
