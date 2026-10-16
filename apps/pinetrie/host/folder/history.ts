// host/folder/history — a folder lane's history: each move a snapshot of the
// lane's disk, recorded as a state of the graph (`STATE`), its parents what
// it came from. A turn is snapshotted, then diffed against the lane's
// newest, the reverse of jj's commit then snapshot, since the diff compares
// snapshots; a catch-up is the path merge on the graph's base, its
// conflicts records (`CONFLICT`) whose versions the lane reads under
// `/pinetrie-states`. Every snapshot is taken by `planSnapshot`, after the
// lane's `sync`. Nothing is fetched anywhere: `follow` is always null.

import {
  type ConflictRecord,
  catchUpStateId,
  type ForkStart,
  folderCopyReady,
  type LaneStatesOp,
  type PointId,
  type StateRecord,
  snapshotId,
  startStateId,
  turnStateId,
  type ValueWrite,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  folderStateHeld,
  isAncestor,
  laneNewest,
  planBase,
  planState,
  type StateGraph,
  stateGraph,
  virtualBaseRecord,
} from "@pinetrie/folder"
import {
  type Edits,
  executeOrThrow,
  type FolderDisks,
  forkSetup,
  type LaneHistory,
  type LaneQueue,
  type LaneRunners,
  type LaneRuntime,
  planSnapshot,
  STATES_MOUNT,
  type TurnCommitted,
} from "@pinetrie/lanes"
import {
  CONFLICT,
  catchUpName,
  conflictKey,
  deleteRecord,
  folderIncoming,
  mergedFrom,
  STATE,
  setRecord,
} from "@pinetrie/rules"
import { sourceChanges } from "./changes.ts"
import { conflictedPaths, mergeInto } from "./merge.ts"
import type { FolderLane } from "./proven.ts"
import { baseMissing, baseState } from "./virtual-base.ts"

/** A folder project's records of its history, as lane work reads and writes them. */
export interface FolderStore {
  readonly states: () => readonly StateRecord[]
  /** The lane's open conflicts. */
  readonly conflicts: (lane: FolderLane["lane"]) => readonly ConflictRecord[]
  readonly write: (writes: readonly ValueWrite[]) => Promise<void>
}

/** What a folder lane's history runs on. */
export interface FolderHistoryDeps {
  readonly runtime: LaneRuntime
  readonly disks: FolderDisks
  /** The project's one queue, the folder's line's reads on it too: a virtual base is made, merged over and deleted on it. */
  readonly queue: LaneQueue
  readonly store: FolderStore
  /** pine·trie's own patterns now (`laneIgnores`, with the lane's shared directories). */
  readonly own: () => string
  readonly newId: () => string
  readonly now: () => number
}

/** A state's record checked against the graph (`planState`); thrown with why when refused. */
function stateWrite(g: StateGraph, record: StateRecord): ValueWrite[] {
  const planned = planState(g, record)
  switch (planned.kind) {
    case "record":
      return [setRecord(STATE, planned.record)]
    case "recorded":
      return []
    case "refused":
      throw new Error(
        `${record.id} cannot be recorded: ${JSON.stringify(planned)}`,
      )
  }
}

export function folderHistory(
  input: FolderHistoryDeps & {
    readonly lane: FolderLane
    readonly runners: LaneRunners
  },
): LaneHistory {
  const { runtime, disks, store, lane: proven } = input
  const lane = proven.lane
  const runners = { ...input.runners, runtime }
  const reader = { runtime, disks, own: input.own }
  const graph = () => stateGraph(store.states())

  /** Snapshot the lane's disk as `state`, after its `sync`. */
  const snapshot = (state: PointId) =>
    executeOrThrow(planSnapshot({ lane, snapshot: snapshotId(state) }), runners)

  /** The lane's newest state; thrown for a lane not begun. */
  const newestOf = (g: StateGraph): PointId => {
    const newest = laneNewest(g, lane)
    if (newest === null) throw new Error(`${lane} has no state yet`)
    return newest
  }

  /** `start` moved to the state of accepted work `of` holds, when there is one. */
  const startOp = (g: StateGraph, of: PointId): LaneStatesOp[] => {
    const held = folderStateHeld(g, of)
    return held === null ? [] : [{ kind: "start", state: held }]
  }

  const openConflicts = () => store.conflicts(lane).map(c => c.path)

  /** A turn's state made and recorded when its source paths changed, with them. */
  async function turn(edits: Edits): Promise<{
    readonly committed: PointId | null
    readonly newest: PointId
    readonly paths: readonly string[]
  }> {
    const g = graph()
    const newest = newestOf(g)
    const state = turnStateId(input.newId())
    await snapshot(state)
    const paths = await sourceChanges(reader, newest, state)
    if (paths.length === 0) {
      await runtime.disk({
        kind: "deleteSnapshots",
        ids: [snapshotId(state)],
      })
      return { committed: null, newest, paths }
    }
    await store.write(
      stateWrite(g, {
        id: state,
        parents: [newest],
        made: { kind: "turn", lane, entry: edits.entry },
        at: input.now(),
        by: null,
      }),
    )
    return { committed: state, newest, paths }
  }

  const committed = (state: PointId | null): TurnCommitted => ({
    point: state,
    conflicted: openConflicts().length > 0,
  })

  return {
    forkSteps: start =>
      forkSetup(start.kind === "accepted" ? snapshotId(start.point) : null, []),

    async begun(start: ForkStart) {
      const from =
        start.kind === "accepted"
          ? start.point
          : start.kind === "recorded"
            ? start.points[0]
            : undefined
      if (from === undefined)
        throw new Error(`a folder lane cannot begin from ${start.kind}`)
      const state = startStateId(input.newId())
      await snapshot(state)
      const g = graph()
      const record: StateRecord = {
        id: state,
        parents: [from],
        made: { kind: "start", lane },
        at: input.now(),
        by: null,
      }
      await store.write(stateWrite(g, record))
      for (const op of startOp(graph(), state)) await disks.states(lane, op)
    },

    async commit(edits) {
      return committed((await turn(edits)).committed)
    },

    async recordTurn(edits) {
      const made = await turn(edits)
      return {
        committed: made.committed,
        newest: made.newest,
        paths: made.paths,
        conflicts: openConflicts(),
        follow: null,
      }
    },

    async base() {
      const g = graph()
      const newest = laneNewest(g, lane)
      const start = newest === null ? null : folderStateHeld(g, newest)
      return start === null
        ? null
        : { base: { kind: "accepted" }, start, source: start }
    },

    readyToMerge: async () => folderCopyReady(),

    async merge(_ready, from, edits) {
      if (from.kind === "wip")
        throw new Error("a folder project has no WIP to catch up with")
      if (edits !== null) await turn(edits)
      const g = graph()
      const ours = newestOf(g)
      const theirs = from.point
      if (isAncestor(g, theirs, ours))
        return { kind: "nothing", ours, mark: null, follow: null }
      const plan = planBase(g, ours, theirs)
      if (plan === null)
        throw new Error(
          `${ours} and ${theirs} share no state: every state of a folder project descends from its first read`,
        )
      if ((await baseMissing(reader, plan)) !== null)
        return {
          kind: "refused",
          reason: `the state this thread shares with ${catchUpName(mergedFrom(from))} is no longer kept`,
          follow: null,
        }
      const state = catchUpStateId(input.newId())
      /**
       * The base had, the lane merged over it and snapshotted, and the
       * records written. A virtual base is named by its bases, so two lanes
       * merging the same bases share its snapshot: on the project's queue,
       * one at a time, neither deletes it under the other. The step never
       * reads the project's folder: a read inside it would queue behind it
       * and never run.
       */
      const mergeOver = async () => {
        const base = await baseState(reader, plan)
        const merged = await mergeInto(reader, {
          disk: lane,
          ours,
          theirs,
          base,
          markers: false,
        })
        await snapshot(state)
        const paths = conflictedPaths(merged)
        const conflicts = paths.map(path => ({
          lane,
          path,
          base,
          ours,
          theirs,
        }))
        const record: StateRecord = {
          id: state,
          parents: [ours, theirs],
          made: { kind: "catch-up", lane },
          at: input.now(),
          by: null,
        }
        // A virtual base becomes a state only when a conflict names it.
        const baseRecord =
          plan.kind === "virtual" && paths.length > 0
            ? stateWrite(g, virtualBaseRecord(plan, input.now()))
            : []
        await store.write([
          ...baseRecord,
          ...stateWrite(g, record),
          ...conflicts.map(c => setRecord(CONFLICT, c)),
        ])
        // Once a state, a virtual base is the sweep's; else it goes now,
        // left behind by an earlier merge or not.
        if (plan.kind === "virtual" && !graph().states.has(plan.name))
          await runtime.disk({
            kind: "deleteSnapshots",
            ids: [snapshotId(plan.name)],
          })
        return { paths, conflicts }
      }
      const { paths, conflicts } =
        plan.kind === "virtual"
          ? await input.queue.enqueue(mergeOver)
          : await mergeOver()
      const after = graph()
      for (const op of [
        ...startOp(after, state),
        ...conflicts.map(({ lane: _, ...c }) => ({
          kind: "conflict" as const,
          ...c,
        })),
      ])
        await disks.states(lane, op)
      if (paths.length > 0)
        return {
          kind: "conflicted",
          from: theirs,
          contents: paths.map(path => ({
            path,
            content: `Your version stays in ${WORKSPACE_ROOT}/${path}. The three versions are at ${STATES_MOUNT}/conflicts/${path}/{base,ours,theirs}.`,
          })),
          ours: [],
          theirs: [],
          follow: null,
        }
      return {
        kind: "clean",
        from: theirs,
        ours,
        merge: state,
        files: await sourceChanges(reader, ours, state),
        commits: [
          folderIncoming(from.kind === "accepted" ? "folder" : "parent"),
        ],
        follow: null,
      }
    },

    conflicts: async () => openConflicts(),

    async resolve(path, choose) {
      const open = store.conflicts(lane).find(c => c.path === path)
      if (open === undefined) return { kind: "refused", why: "no-conflict" }
      if (choose !== "ours") {
        const from = open[choose]
        const [fact] = await disks.pathFacts(from, [path])
        await disks.applyMerge({
          disk: lane,
          base: null,
          theirs: from,
          steps: [
            fact === undefined || fact.kind === "absent"
              ? { kind: "delete", path }
              : { kind: "take", path },
          ],
          markers: false,
        })
      }
      await store.write([deleteRecord(CONFLICT, conflictKey(lane, path))])
      await disks.states(lane, { kind: "resolved", path })
      return { kind: "resolved" }
    },

    // A folder lane's disk needs nothing after a restore.
    afterRestore: async () => {},
  }
}
