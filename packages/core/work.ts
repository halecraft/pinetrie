// core/work — where a lane works, and which files an entry had (ADR-0032,
// ADR-0034).
//
// Every run's prompt, and every assistant message of a lane of its own that
// made tool calls, has a revision record. So one walk up from an entry finds
// the lane it belongs to (the nearest record's), its commit (the nearest
// record with one) and its disk (the nearest record with a snapshot). A lane
// that works directly records its prompts with neither: it still counts as
// the lane above, but the walk passes it for commit and disk.

import {
  type CommitId,
  type EntryId,
  entryId,
  type LaneName,
  type LaneRecord,
  type Position,
  type ProjectRecord,
  type RevisionRecord,
  type SnapshotId,
  type WorkSetting,
} from "./index.ts"
import { ancestry, type TreeIndex } from "./tree.ts"

/** What is above an entry: the lane it belongs to, its commit, and its disk. */
export interface Above {
  /** The nearest record's lane; null where no run has been. */
  readonly lane: LaneName | null
  /** The nearest recorded commit; null means your `@-`. */
  readonly commit: CommitId | null
  /** The nearest recorded snapshot; null means the base snapshot. */
  readonly snapshot: SnapshotId | null
}

/**
 * The lane, commit and disk at `at`, from the revision records above it. The
 * commit and the snapshot are found independently: a turn that changed only
 * ignored files has a snapshot and no commit, and its tracked files are the
 * nearest commit's.
 */
export function nearestRevision(
  index: TreeIndex,
  revisions: ReadonlyMap<string, RevisionRecord>,
  at: Position,
): Above {
  let lane: LaneName | null = null
  let commit: CommitId | null = null
  let snapshot: SnapshotId | null = null
  if (at.kind === "root") return { lane, commit, snapshot }
  for (const id of ancestry(index, at.id).path) {
    const record = revisions.get(id)
    if (record === undefined) continue
    lane ??= record.lane
    commit ??= record.commit
    snapshot ??= record.snapshot
    if (commit !== null && snapshot !== null) break
  }
  return { lane, commit, snapshot }
}

/**
 * The lane's first prompt on the path to `tip`: the entry nearest the root
 * whose revision record names `lane`. A branch's path passes its parent's
 * prompts first, which name the parent's lane, so this is the branch's own
 * (ADR-0039). Null when no run of the lane is on the path.
 */
export function firstPromptOf(
  index: TreeIndex,
  revisions: ReadonlyMap<string, RevisionRecord>,
  lane: LaneName,
  tip: string | null,
): EntryId | null {
  if (tip === null) return null
  const path = ancestry(index, tip).path
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const id = path[i]
    if (id !== undefined && revisions.get(id)?.lane === lane) return entryId(id)
  }
  return null
}

/**
 * Where a new lane works: the send's choice, else the setting of the lane
 * above its fork point, else the project's default for a root lane. A project
 * that cannot have lanes of their own makes any "own copy" work directly in
 * its root. Null with
 * no project: the host has no tools.
 */
export function workFor(input: {
  readonly choice: WorkSetting | null
  readonly above: LaneName | null
  readonly lanes: ReadonlyMap<string, LaneRecord>
  readonly project: ProjectRecord | null
}): WorkSetting | null {
  const { project } = input
  if (project === null) return null
  const wanted =
    input.choice ??
    (input.above === null ? undefined : input.lanes.get(input.above)?.work) ??
    null
  if (project.kind === "direct")
    return wanted?.kind === "direct"
      ? wanted
      : { kind: "direct", dir: project.root }
  if (wanted !== null) return wanted
  return project.rootDefault === "own"
    ? { kind: "own" }
    : { kind: "direct", dir: project.root }
}
