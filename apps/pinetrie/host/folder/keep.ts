// host/folder/keep — what a folder project keeps of its states, said once:
// the snapshots nothing needs any more, to delete, and accepted work's
// states the history may show, from one `liveStates` call over the records
// and one listing of the snapshots there are. A state's record stays: merge
// bases walk parents through every state, so a record removed would break
// every older state's ancestry; a state whose snapshot is gone is known by
// that alone.

import {
  type ConflictRecord,
  lineStates,
  type PointId,
  type ProjectKind,
  type ProposedChangesRecord,
  type StateRecord,
  type ThreadId,
  type WriteJournal,
  writeContent,
} from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  laneNewest,
  liveStates,
  parentLane,
  stateGraph,
} from "@pinetrie/folder"

/** What a folder project keeps, decided: the snapshots that go, and accepted work's states kept. */
export interface KeepPlanned {
  /** States whose snapshots exist and that the live set keeps not. */
  readonly gone: readonly PointId[]
  /**
   * Accepted work's line states and concurrent saves the live set keeps
   * and whose snapshots exist, newest first: accepted work's record's
   * `kept`.
   */
  readonly kept: readonly PointId[]
  /** Accepted work's newest state; null before the project's folder's first read. */
  readonly newest: PointId | null
}

export function planKeep(input: {
  readonly states: readonly StateRecord[]
  readonly lanes: readonly {
    readonly lane: ThreadId
    readonly history: ProjectKind
  }[]
  readonly conflicts: readonly ConflictRecord[]
  readonly proposed: readonly ProposedChangesRecord[]
  /** The writes' journals: what an open one or a kept aside needs is kept. */
  readonly journals: readonly WriteJournal[]
  readonly keep: number
  /** Every snapshot there is (`LaneRuntime.snapshots`). */
  readonly exists: ReadonlySet<PointId>
}): KeepPlanned {
  const graph = stateGraph(input.states)
  const newest = folderNewest(graph)
  if (newest === null) return { gone: [], kept: [], newest }
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
    // An open write streams from its content, a restore's another state's.
    pinned: input.journals.flatMap(j => [
      ...(j.status === "open" ? [j.record.id, writeContent(j.record)] : []),
      ...j.paths.flatMap(p => (p.keptOn === null ? [] : [p.keptOn])),
    ]),
    folderNewest: newest,
    keep: input.keep,
  })
  const has = (id: PointId) => live.has(id) && input.exists.has(id)
  const saves = [...graph.states.values()].filter(
    r => r.made.kind === "concurrent" && has(r.id),
  )
  const kept = lineStates(graph.states, newest).flatMap(r =>
    has(r.id)
      ? [
          ...saves
            .filter(s => s.parents[0] === r.id)
            .sort((a, b) => b.at - a.at)
            .map(s => s.id),
          r.id,
        ]
      : [],
  )
  return {
    gone: [...graph.states.keys()].filter(
      id => input.exists.has(id) && !live.has(id),
    ),
    kept,
    newest,
  }
}
