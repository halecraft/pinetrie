// host/docs — the documents the host always holds: the session's,
// `pinetrie:live` and the places. A root's document is reached only through a
// step's documents or a lease (`roots.ts`).

import type { EntryId, RootId, ThreadId } from "@pinetrie/core"
import { readLaneRecords, readRoots } from "@pinetrie/reads"
import type {
  LiveDocHandle,
  PlacesDocHandle,
  SessionDocHandle,
} from "@pinetrie/schema"

export interface HostDocuments {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
  /** The root a lane works in, from its record (`LANE`); null for none. */
  rootOfLane(lane: ThreadId): RootId | null
  /** The root whose root entry is `entry` (`ROOT.entry`); null for none. */
  rootOfEntry(entry: EntryId): RootId | null
}

/**
 * What a starting host says it opened: `opened` of the directory's `total`
 * roots, those the last host left a run open in (`planLoads`).
 */
export const rootsOpenedWords = (counts: {
  readonly opened: number
  readonly total: number
}): string => {
  const { opened, total } = counts
  const of = `of ${total} ${total === 1 ? "root" : "roots"}`
  return opened === 0
    ? `opened none ${of}`
    : `opened ${opened} ${of}: ${opened === 1 ? "the one" : "those"} the last host left a run open in`
}

/**
 * The roots a starting host opens: those of the lanes `pinetrie:live` still
 * names as running, whose runs the last host left open, crashed or stopped,
 * read before `planClear` empties it. Every other root loads when a step
 * needs it. In order, by id.
 */
export const planLoads = (
  running: readonly ThreadId[],
  rootOfLane: (lane: ThreadId) => RootId | undefined,
): readonly RootId[] => rootsOfLanes(running, rootOfLane)

/** The roots `lanes` work in, once each, in order by id; a lane no root holds names none. */
export const rootsOfLanes = (
  lanes: readonly ThreadId[],
  rootOfLane: (lane: ThreadId) => RootId | undefined,
): readonly RootId[] =>
  [...new Set(lanes.flatMap(lane => rootOfLane(lane) ?? []))].sort()

export function hostDocuments(input: {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
}): HostDocuments {
  const { session, live, places } = input
  return {
    session,
    live,
    places,
    rootOfLane: lane => readLaneRecords(session).get(lane)?.root ?? null,
    rootOfEntry(entry) {
      for (const r of readRoots(session).values())
        if (r.entry === entry) return r.root
      return null
    },
  }
}
