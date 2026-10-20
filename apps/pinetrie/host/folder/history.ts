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
  isRecorded,
  laneStates,
  planGetLatestRecords,
  planLaneMerge,
  planResolve,
  planStateRecords,
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
import { folderLatest, latestSourceName, mergedFrom } from "@pinetrie/rules"
import { sourceChanges } from "./changes.ts"
import { dropUnrecordedBase, mergeToState } from "./merge.ts"
import type { FolderLane } from "./proven.ts"
import { recordWrites } from "./record-writes.ts"
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
  /** The lane's states as recorded now. */
  const states = () => laneStates(store.states(), lane)

  /** Snapshot the lane's disk as `state`, after its `sync`. */
  const snapshot = (state: PointId) =>
    executeOrThrow(planSnapshot({ lane, snapshot: snapshotId(state) }), runners)

  /** `start` moved to the state of accepted work the lane's newest holds, when there is one. */
  const startOp = (records: readonly StateRecord[]): LaneStatesOp[] => {
    const { start } = laneStates(records, lane)
    return start === null ? [] : [{ kind: "start", state: start }]
  }

  const openConflicts = () => store.conflicts(lane).map(c => c.path)

  /** A turn's state made and recorded when its source paths changed, with them. */
  async function turn(edits: Edits): Promise<{
    readonly committed: PointId | null
    readonly newest: PointId
    readonly paths: readonly string[]
  }> {
    const recorded = store.states()
    const { tip: newest } = laneStates(recorded, lane)
    if (newest === null) throw new Error(`${lane} has no state yet`)
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
      recordWrites(
        planStateRecords(recorded, {
          id: state,
          parents: [newest],
          made: { kind: "turn", lane, entry: edits.entry },
          at: input.now(),
          by: null,
        }),
      ),
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
      const recorded = store.states()
      const record: StateRecord = {
        id: state,
        parents: [from],
        made: { kind: "start", lane },
        at: input.now(),
        by: null,
      }
      const writes = recordWrites(planStateRecords(recorded, record))
      // Before the record is written, against the graph it will make: the
      // op renames a symlink over the last, so a fork run again repeats it
      // harmlessly.
      for (const op of startOp([...store.states(), record]))
        await disks.states(lane, op)
      return recordedStart(writes)
    },

    async keptSnapshot() {
      const { tip } = states()
      return tip === null ? null : snapshotId(tip)
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
      const { start } = states()
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
      const theirs = from.point
      const merging = planLaneMerge(store.states(), lane, theirs)
      const { ours } = merging
      if (merging.kind === "nothing")
        return { kind: "nothing", ours, mark: null, follow: null }
      const { plan } = merging
      const recorded = store.states()
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
        const records = planGetLatestRecords({
          states: recorded,
          lane,
          state,
          ours,
          theirs,
          plan,
          base,
          paths,
          at: input.now(),
        })
        await store.write(recordWrites(records))
        await dropUnrecordedBase(runtime, plan, s =>
          isRecorded(store.states(), s),
        )
        return { paths, conflicts: records.conflicts }
      }
      const { paths, conflicts } =
        plan.kind === "virtual"
          ? await input.queue.enqueue(mergeOver)
          : await mergeOver()
      for (const op of [
        ...startOp(store.states()),
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
        states: store.states(),
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
      await store.write(recordWrites(planned.records))
      await disks.states(lane, { kind: "resolved", path })
      return { kind: "resolved" }
    },

    // A folder lane's disk needs nothing after a restore.
    afterRestore: async () => {},
  }
}
