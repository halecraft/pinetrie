// lanes/folder-disks-port — what a folder project's merges ask of the
// machine its disks are on, beside `LaneRuntime`: only the folder adapter is
// given one, so no jj code or fake runtime carries these calls.

import type {
  DiffStat,
  LaneStatesOp,
  MergeStep,
  PathFact,
  PathPair,
  PointId,
  ReadInAnswer,
  ReadPath,
  TextMerged,
  ThreadId,
} from "@pinetrie/core"

/** Every call a folder project makes of its disks. Each throws on failure. */
export interface FolderDisks {
  /** What `state`'s snapshot holds at each path, in order. */
  pathFacts(
    state: PointId,
    paths: readonly string[],
  ): Promise<readonly PathFact[]>
  /** The files and symlinks `state` holds at or under each of `paths`, sorted. */
  filesUnder(
    state: PointId,
    paths: readonly string[],
  ): Promise<readonly string[]>
  /** One file's unified diff from `a` to `b`, cut one byte past `limit`. */
  fileDiff(a: PointId, b: PointId, path: string, limit: number): Promise<string>
  /** Lines added and removed in each of `paths` from `a` to `b`; 0 and 0 for a binary file. */
  diffStats(
    a: PointId,
    b: PointId,
    paths: readonly string[],
  ): Promise<readonly DiffStat[]>
  /** The pairs where `a` holds a file at the pair's `a` and `b` one of the same bytes at its `b`. */
  sameContent(
    a: PointId,
    b: PointId,
    pairs: readonly PathPair[],
  ): Promise<readonly PathPair[]>
  /**
   * A merge's steps applied to `disk` (a lane's, or a virtual base's scratch
   * disk) over `base` (null: empty) from `theirs`; each text step answered
   * clean or conflicted. With `markers`, a conflicted text keeps git's
   * markers, as a virtual base does; else ours.
   */
  applyMerge(input: {
    readonly disk: string
    readonly base: PointId | null
    readonly theirs: PointId
    readonly steps: readonly MergeStep[]
    readonly markers: boolean
  }): Promise<readonly TextMerged[]>
  /** A file of `state`'s, by its path; null when absent. Refused past `limit` bytes. */
  read(state: PointId, path: string, limit: number): Promise<string | null>
  /**
   * The project's folder's `paths` read into `state`, a new state of its line made
   * from `from` (null: empty), `deleted` removed; each path checked against
   * the stamp the host read, before and after its copy. No state when any
   * moved: the host reads again.
   */
  readIn(input: {
    readonly from: PointId | null
    readonly state: PointId
    readonly paths: readonly ReadPath[]
    readonly deleted: readonly string[]
  }): Promise<ReadInAnswer>
  /**
   * `state`'s `paths`, each a regular file, as one tar stream as it comes:
   * a command of the disks role's own, never a call, since its answer is a
   * stream. Throws naming a path that is not a regular file inside the
   * snapshot, a symlink on its way included.
   */
  tarOut(state: PointId, paths: readonly string[]): AsyncIterable<Uint8Array>
  /**
   * One regular file of `state`'s, its bytes as they come: a command of the
   * disks role's own, as `tarOut` is. Throws as `tarOut` does for a path
   * that is no regular file inside the snapshot.
   */
  fileOut(state: PointId, path: string): AsyncIterable<Uint8Array>
  /** A change to `lane`'s states directory, which its container sees read-only. */
  states(lane: ThreadId, op: LaneStatesOp): Promise<void>
}
