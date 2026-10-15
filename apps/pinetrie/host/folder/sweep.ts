// host/folder/sweep — the snapshots of a folder project's states that
// nothing needs any more, deleted: what `liveStates` keeps is decided from
// the records (each folder lane's tip and start, open conflicts' three
// states, open offers' two, your folder's newest states). A state's record
// stays: merge bases walk parents through every state, so a record removed
// would break every older state's ancestry; a state whose snapshot is gone
// is known by that alone.

import type {
  ConflictRecord,
  OfferRecord,
  PointId,
  ProjectKind,
  StateRecord,
  ThreadId,
} from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  laneNewest,
  liveStates,
  stateGraph,
} from "@pinetrie/folder"

/** The states whose snapshots go: every state of the graph the live set keeps not. */
export function planSweep(input: {
  readonly states: readonly StateRecord[]
  readonly lanes: readonly {
    readonly lane: ThreadId
    readonly history: ProjectKind
  }[]
  readonly conflicts: readonly ConflictRecord[]
  readonly offers: readonly OfferRecord[]
  readonly keep: number
}): readonly PointId[] {
  const graph = stateGraph(input.states)
  const newest = folderNewest(graph)
  if (newest === null) return []
  const lanes = input.lanes.flatMap(l => {
    const tip = laneNewest(graph, l.lane)
    const start = tip === null ? null : folderStateHeld(graph, tip)
    return tip === null || start === null
      ? []
      : [{ history: l.history, tip, start }]
  })
  const live = liveStates({
    graph,
    lanes,
    conflicts: input.conflicts,
    offers: input.offers.flatMap(o => (o.kind === "folder" ? [o] : [])),
    folderNewest: newest,
    keep: input.keep,
  })
  return [...graph.states.keys()].filter(id => !live.has(id))
}
