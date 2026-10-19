// host/folder/history — a folder lane's history: each move a snapshot of the
// lane's disk, recorded as a state of the graph (`STATE`), its parents what
// it came from. A turn is snapshotted, then diffed against the lane's
// newest, the reverse of jj's commit then snapshot, since the diff compares
// snapshots; a catch-up is the path merge on the graph's base, its
// conflicts records (`CONFLICT`) whose versions the lane reads under
// `/pinetrie-states`, each closed by a resolution, a state of its own
// (`planResolve`). Every snapshot is taken by `planSnapshot`, after the
// lane's `sync`. Nothing is fetched anywhere: `follow` is always null.

import {
  type ConflictRecord,
  type ForkStart,
  folderCopyReady,
  getLatestStateId,
  type LaneStatesOp,
  type PointId,
  resolveStateId,
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
  planResolve,
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
  recordedStart,
  STATES_MOUNT,
  type TurnCommitted,
} from "@pinetrie/lanes"
import {
  CONFLICT,
  conflictKey,
  deleteRecord,
  folderLatest,
  latestSourceName,
  mergedFrom,
  STATE,
  setRecord,
} from "@pinetrie/rules"
import { sourceChanges } from "./changes.ts"
import { dropUnrecordedBase, mergeToState } from "./merge.ts"
import type { FolderLane } from "./proven.ts"
import { baseMissing } from "./virtual-base.ts"

/** A folder project's records of its history, as lane work reads and writes them. */
interface FolderStore {
  readonly states: () => readonly StateRecord[]
  /** The lane's open conflicts. */
  readonly conflicts: (lane: FolderLane["lane"]) => readonly ConflictRecord[]
  readonly write: (writes: readonly ValueWrite<"session">[]) => Promise<void>
}

/** What a folder lane's history runs on. */
interface FolderHistoryDeps {
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
function stateWrite(
  g: StateGraph,
  record: StateRecord,
): ValueWrite<"session">[] {
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
        kind: "delete-snapshots",
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

    async startRecords(start: ForkStart) {
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
      const writes = stateWrite(g, record)
      // Before the record is written, against the graph it will make: the
      // op renames a symlink over the last, so a fork run again repeats it
      // harmlessly.
      for (const op of startOp(stateGraph([...store.states(), record]), state))
        await disks.states(lane, op)
      return recordedStart(writes)
    },

    async keptSnapshot() {
      const newest = laneNewest(graph(), lane)
      return newest === null ? null : snapshotId(newest)
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
      if (from.kind === "unfinished")
        throw new Error(
          "a folder project has no unfinished work to get the latest from",
        )
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
          reason: `the state this thread shares with ${latestSourceName(mergedFrom(from))} is no longer kept`,
          follow: null,
        }
      const state = getLatestStateId(input.newId())
      /**
       * The base had, the lane merged over it and snapshotted, and the
       * records written. A virtual base is named by its bases, so two lanes
       * merging the same bases share its snapshot: on the project's queue,
       * one at a time, neither deletes it under the other. The step never
       * reads the project's folder: a read inside it would queue behind it
       * and never run.
       */
      const mergeOver = async () => {
        const { base, paths } = await mergeToState(reader, {
          disk: lane,
          ours,
          theirs,
          plan,
          markers: false,
          snapshot: () => snapshot(state),
        })
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
          made: { kind: "get-latest", lane },
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
        await dropUnrecordedBase(runtime, plan, s => graph().states.has(s))
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
        commits: [folderLatest(from.kind === "accepted" ? "folder" : "parent")],
        follow: null,
      }
    },

    conflicts: async () => openConflicts(),

    async resolve(path, choose, who) {
      // gather
      const open = store.conflicts(lane).find(c => c.path === path)
      const [chosen] =
        open === undefined || choose === "ours"
          ? [null]
          : await disks.pathFacts(open[choose], [path])
      // plan
      const planned = planResolve({
        graph: graph(),
        lane,
        path,
        open,
        choose,
        chosen: chosen ?? null,
        id: resolveStateId(input.newId()),
        at: input.now(),
        by: who.kind === "person" ? who.by : null,
      })
      if (planned.kind === "no-conflict")
        return { kind: "refused", why: "no-conflict" }
      // execute
      const { step, record } = planned
      if (open !== undefined && step !== null)
        await disks.applyMerge({
          disk: lane,
          base: null,
          theirs: open[choose],
          steps: [step],
          markers: false,
        })
      // A person's choice comes only while the lane is idle, its container
      // perhaps stopped: a btrfs snapshot holds what its kernel wrote,
      // flushed or not, so no container is started for a `sync`.
      if (who.kind === "agent") await snapshot(record.id)
      else
        await runtime.disk({
          kind: "snapshot",
          lane,
          snapshot: snapshotId(record.id),
        })
      await store.write([
        setRecord(STATE, record),
        deleteRecord(CONFLICT, conflictKey(lane, path)),
      ])
      await disks.states(lane, { kind: "resolved", path })
      return { kind: "resolved" }
    },

    // A folder lane's disk needs nothing after a restore.
    afterRestore: async () => {},
  }
}
