// folder/records — what a folder operation records, decided as values: the
// states it makes, the conflicts it opens and those it closes. The host
// turns them into its record writes in one function, since the record
// specs are `@pinetrie/rules`', which this package does not declare.

import type {
  BasePlan,
  ConflictRecord,
  PointId,
  StateRecord,
  ThreadId,
} from "@pinetrie/core"
import { planState, stateGraph, virtualBaseRecord } from "./graph.ts"

/** What one operation records of a folder project's history. */
export interface FolderRecords {
  readonly states: readonly StateRecord[]
  readonly conflicts: readonly ConflictRecord[]
  /** Conflicts closed: each its lane's at its path. */
  readonly closed: readonly {
    readonly lane: ThreadId
    readonly path: string
  }[]
}

export const NO_RECORDS: FolderRecords = {
  states: [],
  conflicts: [],
  closed: [],
}

/**
 * `record` checked against the graph `states` make (`planState`): recorded,
 * or nothing when the graph holds it already with the same parents (a
 * virtual base made again). Thrown with why when refused: every caller
 * proposes a state the graph must take, so a refusal is a bug.
 */
export function planStateRecords(
  states: readonly StateRecord[],
  record: StateRecord,
): FolderRecords {
  const planned = planState(stateGraph(states), record)
  switch (planned.kind) {
    case "record":
      return { ...NO_RECORDS, states: [planned.record] }
    case "recorded":
      return NO_RECORDS
    case "refused":
      throw new Error(
        `${record.id} cannot be recorded: ${JSON.stringify(planned)}`,
      )
  }
}

/**
 * What getting the latest records once the lane is merged over its base:
 * the merge's state, made `get-latest` with `ours` and `theirs` its parents;
 * a conflict for each path the merge left conflicted; and a virtual base's
 * state, only when a conflict names it, so every base a conflict names is a
 * state of the graph.
 */
export function planGetLatestRecords(input: {
  readonly states: readonly StateRecord[]
  readonly lane: ThreadId
  /** The merge's state. */
  readonly state: PointId
  readonly ours: PointId
  readonly theirs: PointId
  /** How the base was had (`planBase`). */
  readonly plan: BasePlan
  /** The base the merge was made over: a state, or the virtual base's name. */
  readonly base: PointId
  /** The paths the merge left conflicted. */
  readonly paths: readonly string[]
  readonly at: number
}): FolderRecords {
  const { states, lane, ours, theirs, base, at } = input
  const virtual =
    input.plan.kind === "virtual" && input.paths.length > 0
      ? planStateRecords(states, virtualBaseRecord(input.plan, at)).states
      : []
  const merged = planStateRecords(states, {
    id: input.state,
    parents: [ours, theirs],
    made: { kind: "get-latest", lane },
    at,
    by: null,
  }).states
  return {
    states: [...virtual, ...merged],
    conflicts: input.paths.map(path => ({ lane, path, base, ours, theirs })),
    closed: [],
  }
}
