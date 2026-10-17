// host/folder/file-at — a file read at a site of a folder project: your
// folder's newest state, a lane's newest work, or the state of accepted work
// that lane's proposed changes are computed against.

import type { PointId, StateRecord } from "@pinetrie/core"
import {
  folderNewest,
  folderStateHeld,
  laneNewest,
  stateGraph,
} from "@pinetrie/folder"
import type { FileAt, FolderDisks, ReadSite } from "@pinetrie/lanes"

/** The most a file read at a site may hold. */
const FILE_LIMIT = 1024 * 1024

/**
 * The state a site names; null where it has none: accepted work before its
 * first read, or a lane with no work of its own yet (its newest is its
 * start), as a jj lane has no tip until its first turn.
 */
function siteState(
  states: readonly StateRecord[],
  site: ReadSite,
): PointId | null {
  const g = stateGraph(states)
  if (site.kind === "accepted") return folderNewest(g)
  const newest = laneNewest(g, site.lane)
  if (newest === null) return null
  if (site.kind === "start") return folderStateHeld(g, newest)
  return g.states.get(newest)?.made.kind === "start" ? null : newest
}

export async function folderFileAt(
  input: {
    readonly states: () => readonly StateRecord[]
    readonly disks: Pick<FolderDisks, "read">
  },
  site: ReadSite,
  path: string,
): Promise<FileAt> {
  const at = siteState(input.states(), site)
  if (at === null) return { kind: "no-site" }
  return {
    kind: "read",
    at,
    text: await input.disks.read(at, path, FILE_LIMIT),
  }
}
