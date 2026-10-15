// host/folder/conflicts — what a merge's conflicts become, as values: a
// `ConflictRecord` for each path it left conflicted, and the lane's states
// directory changed to show each one's three versions. Executed after, so a
// conflicted merge's records are tested with no disk.

import type {
  ConflictRecord,
  LaneStatesOp,
  PointId,
  ThreadId,
} from "@pinetrie/core"

/** A merge's conflicts, recorded and shown. */
export interface ConflictsPlanned {
  readonly records: readonly ConflictRecord[]
  readonly ops: readonly LaneStatesOp[]
}

/**
 * The records and states ops of `paths`, conflicted by a merge of `theirs`
 * into `ours` over `base`; none for a clean merge.
 */
export function planConflicts(input: {
  readonly lane: ThreadId
  readonly paths: readonly string[]
  readonly base: PointId
  readonly ours: PointId
  readonly theirs: PointId
}): ConflictsPlanned {
  const { lane, base, ours, theirs } = input
  const paths = [...input.paths].sort()
  return {
    records: paths.map(path => ({ lane, path, base, ours, theirs })),
    ops: paths.map(path => ({ kind: "conflict", path, base, ours, theirs })),
  }
}

/** Where a conflicted path's three versions are, in its lane. */
export const conflictVersions = (path: string): string =>
  `/pinetrie-states/conflicts/${path}/{base,ours,theirs}`
