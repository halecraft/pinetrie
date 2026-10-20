// folder/resolve — a folder lane's conflict closed by a choice, decided as a
// value: the merge step that puts the chosen version in the lane's disk,
// the state the lane records of it, and the conflict it closes. The agent's tool and the page both
// take this path, so a resolution is always a state of the lane's own.

import type {
  ConflictChoice,
  ConflictRecord,
  MergeStep,
  PathFact,
  PointId,
  StateRecord,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { laneStates } from "./graph.ts"
import { type FolderRecords, planStateRecords } from "./records.ts"

/** What closing a conflict does. */
export type ResolvePlanned =
  | { readonly kind: "no-conflict" }
  | {
      readonly kind: "resolve"
      /** What puts the chosen version on the lane's disk; null for `ours`, which it holds. */
      readonly step: MergeStep | null
      /** The lane's state of the resolution, its one parent the lane's newest. */
      readonly record: StateRecord
      /** What it records: that state, and the conflict closed. */
      readonly records: FolderRecords
    }

/**
 * `lane`'s open conflict at `path` closed with `choose`'s version: none to
 * close when `open` is undefined; else the chosen side's file taken, or
 * deleted where that side holds none, and a `resolve` state on the lane's
 * newest. Throws when the graph refuses the state, which only a lane with
 * no state, or two newest, can make it.
 */
export function planResolve(input: {
  readonly states: readonly StateRecord[]
  readonly lane: ThreadId
  readonly path: string
  readonly open: ConflictRecord | undefined
  readonly choose: ConflictChoice
  /** What the chosen version's state holds at `path`; not read for `ours`. */
  readonly chosen: PathFact | null
  readonly id: PointId
  readonly at: number
  readonly by: WriterId | null
}): ResolvePlanned {
  const { lane, path, open } = input
  if (open === undefined) return { kind: "no-conflict" }
  const { tip } = laneStates(input.states, lane)
  if (tip === null)
    throw new Error(`${lane}'s resolution of ${path} has no state to be on`)
  const record: StateRecord = {
    id: input.id,
    parents: [tip],
    made: { kind: "resolve", lane, path },
    at: input.at,
    by: input.by,
  }
  const recorded = planStateRecords(input.states, record)
  const step: MergeStep | null =
    input.choose === "ours"
      ? null
      : input.chosen === null || input.chosen.kind === "absent"
        ? { kind: "delete", path }
        : { kind: "take", path }
  return {
    kind: "resolve",
    step,
    record,
    records: { ...recorded, closed: [{ lane, path }] },
  }
}
