// folder/resolve — a folder lane's conflict closed by a choice, decided as a
// value: the merge step that puts the chosen version in the lane's disk,
// and the state the lane records of it. The agent's tool and the page both
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
import { laneNewest, planState, type StateGraph } from "./graph.ts"

/** What closing a conflict does. */
export type ResolvePlanned =
  | { readonly kind: "no-conflict" }
  | {
      readonly kind: "resolve"
      /** What puts the chosen version on the lane's disk; null for `ours`, which it holds. */
      readonly step: MergeStep | null
      /** The lane's state of the resolution, its one parent the lane's newest. */
      readonly record: StateRecord
    }

/**
 * `lane`'s open conflict at `path` closed with `choose`'s version: none to
 * close when `open` is undefined; else the chosen side's file taken, or
 * deleted where that side holds none, and a `resolve` state on the lane's
 * newest. Throws when the graph refuses the state, which only a lane with
 * no state, or two newest, can make it.
 */
export function planResolve(input: {
  readonly graph: StateGraph
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
  const newest = laneNewest(input.graph, lane)
  const planned =
    newest === null
      ? null
      : planState(input.graph, {
          id: input.id,
          parents: [newest],
          made: { kind: "resolve", lane, path },
          at: input.at,
          by: input.by,
        })
  if (planned?.kind !== "record")
    throw new Error(
      `${lane}'s resolution of ${path} cannot be recorded: ${JSON.stringify(planned)}`,
    )
  const step: MergeStep | null =
    input.choose === "ours"
      ? null
      : input.chosen === null || input.chosen.kind === "absent"
        ? { kind: "delete", path }
        : { kind: "take", path }
  return { kind: "resolve", step, record: planned.record }
}
