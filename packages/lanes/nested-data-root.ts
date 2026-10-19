// lanes/nested-data-root — where a nested lane's inner Docker data root
// comes from at a start or a fork: a clone of the nested lane that ran last,
// counted in run ends.

import type { ThreadId } from "@pinetrie/core"

/**
 * How fresh each nested lane's inner Docker data root is, counted in run
 * ends, and which lane's run ended last: its data root is the one to clone.
 * A host's own, in memory.
 */
export interface InnerDockerDataRoots {
  /** Nested lanes' runs ended, their containers stopped, since the host started. */
  readonly runsEnded: number
  /** The nested lane whose container stopped last after a run, and at which run end. */
  readonly lastRunLane: {
    readonly lane: ThreadId
    readonly atRunEnd: number
  } | null
  /** The run end each lane's data root is as of, by its own run or a clone. */
  readonly clonedAtRunEnd: ReadonlyMap<ThreadId, number>
}

export const NO_INNER_DOCKER_DATA_ROOTS: InnerDockerDataRoots = {
  runsEnded: 0,
  lastRunLane: null,
  clonedAtRunEnd: new Map(),
}

/** Where a lane's inner Docker data root comes from at a start or a fork. */
export type InnerDockerDataRootSource =
  | { readonly kind: "keep" }
  | {
      readonly kind: "clone"
      readonly cloneFromLane: ThreadId
      /** The run end the clone is as of; null for a fork's source lane, as of none. */
      readonly atRunEnd: number | null
    }

const KEEP_DATA_ROOT: InnerDockerDataRootSource = { kind: "keep" }

/**
 * Where a lane's inner Docker data root comes from: the last run's lane's,
 * unless the lane's own is as of that run end already; else the fork's source
 * lane's. A lane is never its own source, and lanehost keeps a lane's own when
 * the source's has gone, so a lane deleted since needs no bookkeeping here.
 */
export function planInnerDockerDataRootSource(input: {
  readonly roots: InnerDockerDataRoots
  readonly lane: ThreadId
  /** The run end this lane's data root is as of; null at a fork, whose delete dropped it. */
  readonly clonedAtRunEnd: number | null
  /** The lane whose disk the fork clones; null at a start. */
  readonly forkSourceLane: ThreadId | null
}): InnerDockerDataRootSource {
  const last = input.roots.lastRunLane
  if (last !== null && last.lane !== input.lane)
    return input.clonedAtRunEnd === last.atRunEnd
      ? KEEP_DATA_ROOT
      : { kind: "clone", cloneFromLane: last.lane, atRunEnd: last.atRunEnd }
  // The last run's own: the freshest there is, unless a fork dropped it.
  if (last !== null && input.clonedAtRunEnd !== null) return KEEP_DATA_ROOT
  if (input.forkSourceLane !== null && input.forkSourceLane !== input.lane)
    return {
      kind: "clone",
      cloneFromLane: input.forkSourceLane,
      atRunEnd: null,
    }
  return KEEP_DATA_ROOT
}

/** After a nested lane's container stopped at a run's end: it is the last run's lane. */
export function innerDockerDataRootsAfterRunEnd(
  roots: InnerDockerDataRoots,
  lane: ThreadId,
): InnerDockerDataRoots {
  const atRunEnd = roots.runsEnded + 1
  return {
    runsEnded: atRunEnd,
    lastRunLane: { lane, atRunEnd },
    clonedAtRunEnd: new Map(roots.clonedAtRunEnd).set(lane, atRunEnd),
  }
}

/** After a lane's data root was made from `source`: the run end it is as of, if any. */
export function innerDockerDataRootsAfterClone(
  roots: InnerDockerDataRoots,
  lane: ThreadId,
  source: InnerDockerDataRootSource,
): InnerDockerDataRoots {
  if (source.kind === "keep") return roots
  const clonedAtRunEnd = new Map(roots.clonedAtRunEnd)
  if (source.atRunEnd === null) clonedAtRunEnd.delete(lane)
  else clonedAtRunEnd.set(lane, source.atRunEnd)
  return { ...roots, clonedAtRunEnd }
}
