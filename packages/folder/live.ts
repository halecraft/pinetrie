// folder/live — the snapshots a folder project keeps. A state's record is
// never deleted, since merge bases walk parents through every state, kept or
// not; only snapshots outside this set are swept. Kept by count, not by
// size: a snapshot's own bytes need btrfs quota groups, which the disks role
// cannot enable.

import type { PointId, ProjectKind } from "@pinetrie/core"
import { mergeBases, type StateGraph } from "./graph.ts"

export interface LiveInput {
  readonly graph: StateGraph
  /** Every lane of the project's, foreign ones included. */
  readonly lanes: readonly {
    readonly history: ProjectKind
    readonly tip: PointId
    readonly start: PointId
  }[]
  readonly conflicts: readonly {
    readonly base: PointId
    readonly ours: PointId
    readonly theirs: PointId
  }[]
  readonly offers: readonly {
    readonly start: PointId
    readonly tip: PointId
  }[]
  /** Your folder's newest state. */
  readonly folderNewest: PointId
  /** How many of your folder's line states to keep, newest first; the newest always. */
  readonly keep: number
}

/**
 * The states whose snapshots are kept: each folder lane's tip, start and
 * merge bases with your folder's newest state; every conflict's three
 * states; each offer's two; and your folder's newest `keep` line states,
 * along first parents. A virtual base no conflict names is not kept: it is
 * made again when a merge needs it.
 */
export function liveStates(input: LiveInput): ReadonlySet<PointId> {
  const live = new Set<PointId>()
  for (const lane of input.lanes) {
    if (lane.history !== "folder") continue
    live.add(lane.tip).add(lane.start)
    for (const b of mergeBases(input.graph, lane.tip, input.folderNewest))
      live.add(b)
  }
  for (const c of input.conflicts) live.add(c.base).add(c.ours).add(c.theirs)
  for (const o of input.offers) live.add(o.start).add(o.tip)
  let line: PointId | undefined = input.folderNewest
  for (
    let kept = 0;
    line !== undefined && kept < Math.max(input.keep, 1);
    kept++
  ) {
    live.add(line)
    line = input.graph.states.get(line)?.parents[0]
  }
  return live
}
