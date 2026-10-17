// host/folder/sweep — the snapshots of a folder project's states that nothing
// needs any more, deleted: what `liveStates` keeps is decided from the records
// (each folder lane's tip, start and merge bases with accepted work and with
// its parent lane, open conflicts' three states, open proposed changes' two
// and their shown merges, what an accept's journal needs, accepted work's
// newest states, and the concurrent saves on those kept). A state's record stays: merge bases walk
// parents through every state, so a record removed would break every older
// state's ancestry; a state whose snapshot is gone is known by that alone.

import type {
  AcceptJournal,
  ConflictRecord,
  PointId,
  ProjectKind,
  ProposedChangesRecord,
  StateRecord,
  ThreadId,
} from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  laneNewest,
  liveStates,
  parentLane,
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
  readonly proposed: readonly ProposedChangesRecord[]
  /** The accepts' journals: what an open one or a kept aside needs is kept. */
  readonly journals: readonly AcceptJournal[]
  readonly keep: number
}): readonly PointId[] {
  const graph = stateGraph(input.states)
  const newest = folderNewest(graph)
  if (newest === null) return []
  const lanes = input.lanes.flatMap(l => {
    const tip = laneNewest(graph, l.lane)
    const start = tip === null ? null : folderStateHeld(graph, tip)
    // The parent's newest whether or not it is still served: a lane archived
    // since cannot be caught up with, and its base costs one snapshot.
    const from = parentLane(graph, l.lane)
    const parent = from === null ? null : laneNewest(graph, from)
    return tip === null || start === null
      ? []
      : [{ history: l.history, tip, start, parent }]
  })
  const live = liveStates({
    graph,
    lanes,
    conflicts: input.conflicts,
    proposed: input.proposed.flatMap(o => (o.kind === "folder" ? [o] : [])),
    pinned: input.journals.flatMap(j => [
      ...(j.status === "open" ? [j.record.id] : []),
      ...j.paths.flatMap(p => (p.keptOn === null ? [] : [p.keptOn])),
    ]),
    folderNewest: newest,
    keep: input.keep,
  })
  return [...graph.states.keys()].filter(id => !live.has(id))
}
