// core/work — where a lane works, and which files an entry had (ADR-0032,
// ADR-0034).
//
// Every run's prompt, and every assistant message of a lane of its own that
// made tool calls, has a revision record. So one walk up from an entry finds
// the lane it belongs to (the nearest record's), its commit (the nearest
// record with one) and its disk (the nearest record with a snapshot). A lane
// with no copy of its own records its prompts with neither: it still counts
// as the lane above, but the walk passes it for commit and disk.

import type {
  CommitId,
  EntryId,
  Position,
  RevisionRecord,
  SnapshotId,
  ThreadId,
} from "./index.ts"
import { ancestry, type TreeIndex } from "./tree.ts"

/** What is above an entry: the lane it belongs to, its commit, and its disk. */
export interface Above {
  /** The nearest record's lane; null where no run has been. */
  readonly lane: ThreadId | null
  /** The nearest recorded commit; null means the thread's base (ADR-0104). */
  readonly commit: CommitId | null
  /**
   * The lane of the record holding `commit`: the copy a fork clones. Not
   * `lane` when the nearest record's lane has no copy of its own and records none.
   */
  readonly commitLane: ThreadId | null
  /** The nearest recorded snapshot; null means the base snapshot. */
  readonly snapshot: SnapshotId | null
}

/**
 * The lane, commit and disk at `at`, from the revision records above it, and
 * the lane whose record holds the commit. The commit and the snapshot are
 * found independently: a turn that changed only
 * ignored files has a snapshot and no commit, and its tracked files are the
 * nearest commit's.
 */
export function nearestRevision(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  at: Position,
): Above {
  let lane: ThreadId | null = null
  let commit: CommitId | null = null
  let commitLane: ThreadId | null = null
  let snapshot: SnapshotId | null = null
  if (at.kind === "root") return { lane, commit, commitLane, snapshot }
  for (const id of ancestry(index, at.id).path) {
    const record = revisions.get(id)
    if (record === undefined) continue
    lane ??= record.lane
    if (commit === null && record.commit !== null) {
      commit = record.commit
      commitLane = record.lane
    }
    snapshot ??= record.snapshot
    if (commit !== null && snapshot !== null) break
  }
  return { lane, commit, commitLane, snapshot }
}

/** The thread a lane's copy was cloned from, and the commit it was cloned at. */
export interface ForkParent {
  readonly lane: ThreadId
  readonly commit: CommitId
}

/**
 * Where `lane`, whose thread ends at `tip`, was cloned from: the nearest
 * commit above its first prompt, and the lane that recorded it, which is
 * what `forkPoint` clones. Null for a lane that began at its base, with no
 * commit above it (ADR-0072).
 */
export function forkParent(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  lane: ThreadId,
  tip: EntryId | null,
): ForkParent | null {
  const first = firstPromptOf(index, revisions, lane, tip)
  const above = first === null ? null : index.parentOf(first)
  if (above === null) return null
  const { commit, commitLane } = nearestRevision(index, revisions, {
    kind: "entry",
    id: above,
  })
  return commit === null || commitLane === null
    ? null
    : { lane: commitLane, commit }
}

/** The files conflicted in `commit`, as the records naming it say. */
export function conflictsAt(
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  commit: CommitId,
): readonly string[] {
  const files = new Set<string>()
  for (const r of revisions.values())
    if (r.commit === commit) for (const f of r.conflicts) files.add(f)
  return [...files].sort()
}

/**
 * The lane's first prompt on the path to `tip`: the entry nearest the root
 * whose revision record names `lane`. A branch's path passes its parent's
 * prompts first, which name the parent's lane, so this is the branch's own
 * (ADR-0039). Null when no run of the lane is on the path.
 */
export function firstPromptOf(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  lane: ThreadId,
  tip: EntryId | null,
): EntryId | null {
  if (tip === null) return null
  const path = ancestry(index, tip).path
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const id = path[i]
    if (id !== undefined && revisions.get(id)?.lane === lane) return id
  }
  return null
}
