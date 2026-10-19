// lanehost/disks-client — a project's disks as a runtime gives them to the
// host: each call one lanehost call on the project's key. Its shape is lanes'
// `LaneDisks` and `FolderDisks`, typed here by core alone, so lanehost
// declares no lanes; a runtime spreads it and `tsc` checks the fit.

import {
  type DiskOp,
  type LaneStatesOp,
  type MergeStep,
  type PathPair,
  type PointId,
  type ReadPath,
  type SnapshotId,
  snapshotId,
} from "@pinetrie/core"
import type { Lanehost } from "./client.ts"
import { LANE_FILES } from "./layout.ts"

/** The most a file of pine·trie's own on a disk may hold: `base.json` is a few hundred bytes. */
const LANE_FILE_LIMIT = 1024 * 1024

/** A disks role's command whose answer is a stream, never a call (`tar-out.ts`, `file-out.ts`). */
export type StreamCommand = "tar" | "file"

/**
 * The disk calls of a project keyed `key`, through `call`. `out` is the
 * runtime's: a disks role's stream command run on a snapshot's path, with
 * `stdin`, its stdout as it comes; asked only after the snapshot is found.
 */
export function lanehostDisks(input: {
  readonly call: Lanehost["call"]
  readonly key: string
  readonly out: (
    command: StreamCommand,
    snapshot: SnapshotId,
    stdin: string,
  ) => AsyncIterable<Uint8Array>
}) {
  const { call, key: project, out } = input
  async function* streamed(
    command: StreamCommand,
    state: PointId,
    stdin: string,
  ): AsyncIterable<Uint8Array> {
    const snapshot = snapshotId(state)
    if (!(await call({ kind: "snapshot-exists", project, snapshot })))
      throw new Error(`the state ${state} has no snapshot`)
    yield* out(command, snapshot, stdin)
  }
  return {
    disk: async (op: DiskOp): Promise<void> => {
      await call({ kind: "disk", project, op })
    },
    diskExists: (lane: string) => call({ kind: "disk-exists", project, lane }),
    snapshotExists: (snapshot: SnapshotId) =>
      call({ kind: "snapshot-exists", project, snapshot }),
    snapshots: async (): Promise<readonly SnapshotId[]> =>
      (await call({ kind: "snapshots", project })).map(snapshotId),
    diff: (from: SnapshotId, to: SnapshotId) =>
      call({ kind: "diff", project, from, to }),
    readLaneFile: (snapshot: SnapshotId, file: string) =>
      call({
        kind: "read",
        project,
        snapshot,
        path: `${LANE_FILES}/${file}`,
        limit: LANE_FILE_LIMIT,
      }),
    folder: {
      pathFacts: (snapshot: PointId, paths: readonly string[]) =>
        call({ kind: "path-facts", project, snapshot, paths }),
      fileDiff: (a: PointId, b: PointId, path: string, limit: number) =>
        call({ kind: "file-diff", project, a, b, path, limit }),
      diffStats: (a: PointId, b: PointId, paths: readonly string[]) =>
        call({ kind: "diff-stats", project, a, b, paths }),
      filesUnder: (snapshot: PointId, paths: readonly string[]) =>
        call({ kind: "files-under", project, snapshot, paths }),
      sameContent: (a: PointId, b: PointId, pairs: readonly PathPair[]) =>
        call({ kind: "same-content", project, a, b, pairs }),
      applyMerge: (merge: {
        readonly disk: string
        readonly base: PointId | null
        readonly theirs: PointId
        readonly steps: readonly MergeStep[]
        readonly markers: boolean
      }) => call({ kind: "apply-merge", project, ...merge }),
      read: (snapshot: PointId, path: string, limit: number) =>
        call({ kind: "read", project, snapshot, path, limit }),
      readIn: (read: {
        readonly from: PointId | null
        readonly state: PointId
        readonly paths: readonly ReadPath[]
        readonly deleted: readonly string[]
      }) => call({ kind: "read-in", project, ...read }),
      tarOut: (state: PointId, paths: readonly string[]) =>
        streamed("tar", state, paths.map(p => `${p}\0`).join("")),
      fileOut: (state: PointId, path: string) => streamed("file", state, path),
      states: async (lane: string, op: LaneStatesOp): Promise<void> => {
        await call({ kind: "states", project, lane, op })
      },
    },
  }
}
