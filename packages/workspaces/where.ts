// workspaces/where — where a lane works, as a pure decision over the records.

import path from "node:path"
import type { LaneName, LaneRecord, ProjectRecord } from "@pineta/core"

/** A lane's own workspace: `workspace/<lane>` in the project (ADR-0032). */
export const workspaceDir = (root: string, lane: LaneName): string =>
  path.join(root, "workspace", lane)

/** The bookmark that holds a lane's newest revision, and makes it immutable. */
export const bookmarkName = (lane: LaneName): string => `pineta/${lane}`

/**
 * Where `lane` works, and the other roots its history is rewritten from and
 * its file tools refuse: every other lane's workspace, and your working copy.
 * A lane working directly has none: its files are not the fork point's, so a
 * rewrite would be false. Null for a lane with no record.
 */
export function planWhere(
  input: {
    readonly project: ProjectRecord
    readonly records: ReadonlyMap<string, LaneRecord>
  },
  lane: LaneName,
): { readonly dir: string; readonly others: readonly string[] } | null {
  const record = input.records.get(lane)
  if (record === undefined) return null
  const { project } = input
  if (record.work.kind === "direct") return { dir: record.work.dir, others: [] }
  if (project.kind === "direct") return { dir: project.root, others: [] }
  const others = [...input.records.values()]
    .filter(r => r.lane !== lane && r.work.kind === "own")
    .map(r => workspaceDir(project.root, r.lane))
  return {
    dir: workspaceDir(project.root, lane),
    others: [...others, project.root],
  }
}
