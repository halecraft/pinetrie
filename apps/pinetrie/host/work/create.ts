// host/work/create — a new lane: where it works, its record and name, and, for
// a lane of its own, its fork from where it branched, or from accepted work or
// a WIP's copy where nothing is above. The send records the lane, its fork
// owed; the lane's start runs the fork (`containers.ts`).

import {
  atEntry,
  BASE_SNAPSHOT,
  type ErrCode,
  type OwnLane,
  type Position,
  type ProjectKind,
  ROOT,
  type SnapshotId,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import {
  executeFork,
  type Forked,
  type LaneHandle,
  type LaneHistory,
  planFork,
  type StartRecords,
} from "@pinetrie/lanes"
import type { LaneChannel } from "@pinetrie/pi"
import {
  type RootView,
  readLaneRecords,
  readRevisions,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type ForkBegin,
  foreignLaneWords,
  forkSource,
  type LaneForkRecord,
  planForkEnd,
  planForkRedo,
  planLaneRecords,
  sourceHistory,
} from "@pinetrie/rules"
import {
  forkEntry,
  nearestRevision,
  type ThreadOrigin,
} from "@pinetrie/threads"
import type { Basics, LeaseBasics } from "../basics.ts"
import type { Records } from "../records.ts"
import type { Destination } from "./destination.ts"
import type { InnerDockerDataRootsHeld } from "./inner-docker-data-roots.ts"
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
  /**
   * Record a new lane in its root, its fork owed, and name it. Its fork runs
   * at its start (`fork`).
   */
  prepareLane(
    view: RootView,
    lane: ThreadId,
    at: Position,
    by: WriterId,
    base: string | null,
  ): Promise<void>
  /**
   * Fork `lane` from where its thread begins: its disk and container
   * replaced, its history's start recorded, its fork begun. Run from a step
   * on the lane's queue, which holds `h`; `fork` is read in that step.
   */
  fork(
    lane: ThreadId,
    h: LaneHistory,
    handle: LaneHandle<LaneChannel>,
    record: OwnLane,
    fork: LaneForkRecord,
  ): Promise<void>
}

/**
 * Record a new lane (`planLaneRecords`) and name it: every lane has both, a
 * host without tools' too, whose lanes have no copy of their own (`kind`
 * null).
 */
export async function prepareLane(
  deps: {
    readonly basics: Pick<Basics, "now" | "session">
    readonly records: Pick<Records, "writeValues">
    readonly ensureNames: () => Promise<void>
    /** The project's kind; null for a host without tools. */
    readonly kind: ProjectKind | null
  },
  view: Pick<RootView, "root" | "doc">,
  lane: ThreadId,
  at: Position,
  by: WriterId,
  base: string | null,
): Promise<void> {
  const { kind } = deps
  const { doc } = view
  // The kind of the disk it will clone, read as if its snapshot is kept: a
  // lost one falls back to the base, the project's kind, which differs only
  // for a source of another kind, refused before a send.
  const history =
    kind === null
      ? null
      : sourceHistory({
          above: nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
          kept: true,
          lanes: readLaneRecords(deps.basics.session),
          kind,
        })
  await deps.records.writeValues(
    planLaneRecords({
      record: {
        lane,
        root: view.root,
        history,
        by,
        createdAt: deps.basics.now(),
      },
      base,
    }),
  )
  await deps.ensureNames()
}

/**
 * A fork's end written (`planForkEnd`): it takes a `Forked`, which only
 * `executeFork` makes, so no record says begun for a fork whose steps did not
 * run.
 */
export const forkEnd = (input: {
  readonly fork: LaneForkRecord
  readonly lost: SnapshotId | null
  readonly forked: Forked
  readonly start: StartRecords
}): readonly ValueWrite<"session">[] => planForkEnd(input)

/**
 * Where a lane's fork begins in its root: its thread's fork entry, else the
 * root. Its first agent message may come after chat of its own thread, which
 * carries no revision record, so the nearest revision above either is the
 * same.
 */
const forkPosition = (origin: ThreadOrigin | undefined): Position => {
  const entry = origin === undefined ? null : forkEntry(origin)
  return entry === null ? ROOT : atEntry(entry)
}

export function createNewLanes(deps: {
  readonly basics: LeaseBasics
  readonly setup: Setup
  readonly records: Pick<Records, "writeValues">
  readonly ensureNames: () => Promise<void>
  readonly pendingRecords: Turns["pendingRecords"]
  readonly destination: Pick<Destination, "begin">
  readonly innerDockerDataRoots: InnerDockerDataRootsHeld
}): NewLanes {
  const { basics, setup, destination } = deps
  const { session } = basics

  return {
    async checkBegin(view, at, base) {
      const { doc } = view
      const above = nearestRevision(readTreeIndex(doc), readRevisions(doc), at)
      if (above.point !== null) return null
      const begin = await destination.begin(base)
      return typeof begin === "string" ? begin : null
    },

    prepareLane: (view, lane, at, by, base) =>
      prepareLane(
        { ...deps, kind: setup.opened.kind },
        view,
        lane,
        at,
        by,
        base,
      ),

    async fork(lane, h, handle, record, fork) {
      const { runtime } = setup
      const { kind } = setup.opened
      // gather
      await using held = basics.leases.lane(lane)
      if (held === null) throw new Error(`${lane} is in no root`)
      const doc = await held.ready
      const at = forkPosition(readThreads(session).get(lane)?.origin)
      const facts = await forkFacts({
        pendingRecords: deps.pendingRecords,
        nearest: () =>
          nearestRevision(readTreeIndex(doc), readRevisions(doc), at),
        begin: () => destination.begin(fork.base),
        exists: id => runtime.snapshotExists(id),
      })
      if (typeof facts === "string")
        throw new Error(`the lane cannot begin: ${facts}`)
      // plan
      const source = forkSource({
        ...facts,
        lane: record,
        lanes: readLaneRecords(session),
        kind,
      })
      if (source.kind === "foreign") throw new Error(foreignLaneWords(source))
      const forkSetup = h.forkSteps(source.start)
      const dataRoot = deps.innerDockerDataRoots.sourceAtFork(
        lane,
        facts.above.snapshotLane,
      )
      const steps = planFork({
        source,
        spec: setup.specOf(lane),
        env: process.env,
        setup: forkSetup,
        innerDockerDataRoot: dataRoot,
      })
      // execute
      const redo = planForkRedo(fork)
      if (redo.length > 0) await deps.records.writeValues(redo)
      if (forkSetup.from === null && source.snapshot === BASE_SNAPSHOT)
        await setup.baseAtAccepted()
      const forked = await executeFork(steps, handle.runners)
      deps.innerDockerDataRoots.made(lane, dataRoot)
      const start = await h.startRecords(source.start)
      await deps.records.writeValues(
        forkEnd({ fork, lost: source.lost, forked, start }),
      )
      // The fork's `run` made it, and started it.
      await handle.start("running")
    },
  }
}
