// host/folder/file-at — a file read at a site of a folder project: your
// folder's newest state, a lane's newest work, or the state of accepted work
// that lane's proposed changes are computed against.

import type { PointId, StateRecord } from "@pinetrie/core"
import { laneStates } from "@pinetrie/folder"
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
  if (site.kind === "accepted") return laneStates(states, null).newest
  const { graph, tip, start } = laneStates(states, site.lane)
  if (tip === null) return null
  if (site.kind === "start") return start
  return graph.states.get(tip)?.made.kind === "start" ? null : tip
}

export async function readFolderSiteFile(
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
