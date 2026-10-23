// threads/work — where a lane works, and which files an entry had.
//
// Every run's prompt, and every assistant message of a lane of its own that
// made tool calls, has a revision record. So one walk up from an entry finds
// the lane it belongs to (the nearest record's), its state (the nearest
// record with one) and its disk (the nearest record with a snapshot). A lane
// with no copy of its own records its prompts with neither: it still counts
// as the lane above, but the walk passes it for state and disk.

import type {
  EntryId,
  PointId,
  Position,
  RevisionRecord,
  SnapshotId,
  ThreadId,
} from "@pinetrie/core"
import { ancestry, type TreeIndex } from "./tree.ts"

/** What is above an entry: the lane it belongs to, its state, and its disk. */
export interface Above {
  /** The nearest record's lane; null where no run has been. */
  readonly lane: ThreadId | null
  /** The nearest recorded state; null means the thread's base. */
  readonly point: PointId | null
  /**
   * The lane of the record holding `point`: the copy a fork clones. Not
   * `lane` when the nearest record's lane has no copy of its own and records none.
   */
  readonly pointLane: ThreadId | null
  /** The nearest recorded snapshot; null means the base snapshot. */
  readonly snapshot: SnapshotId | null
  /** The lane of the record holding `snapshot`: whose disk a fork clones. */
  readonly snapshotLane: ThreadId | null
}

/**
 * The lane, state and disk at `at`, from the revision records above it, and
 * the lane whose record holds the state. The state and the snapshot are
 * found independently: a turn that changed only
 * ignored files has a snapshot and no state, and its tracked files are the
 * nearest state's.
 */
export function nearestRevision(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  at: Position,
): Above {
  let lane: ThreadId | null = null
  let point: PointId | null = null
  let pointLane: ThreadId | null = null
  let snapshot: SnapshotId | null = null
  let snapshotLane: ThreadId | null = null
  if (at.kind === "root")
    return { lane, point, pointLane, snapshot, snapshotLane }
  for (const id of ancestry(index, at.id).path) {
    const record = revisions.get(id)
    if (record === undefined) continue
    lane ??= record.lane
    if (point === null && record.point !== null) {
      point = record.point
      pointLane = record.lane
    }
    if (snapshot === null && record.snapshot !== null) {
      snapshot = record.snapshot
      snapshotLane = record.lane
    }
    if (point !== null && snapshot !== null) break
  }
  return { lane, point, pointLane, snapshot, snapshotLane }
}

/**
 * The nearest snapshot above `at` that is not `gone`: what a fork clones for
 * the files a lost snapshot's commit leaves untracked. `gone` is what the
 * host knows is: the lost one, and the index's rows marked to delete or
 * deleted; the host still checks the one found is there.
 */
export function nearestKeptSnapshot(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  at: Position,
  gone: ReadonlySet<SnapshotId>,
): SnapshotId | null {
  if (at.kind === "root") return null
  for (const id of ancestry(index, at.id).path) {
    const snapshot = revisions.get(id)?.snapshot ?? null
    if (snapshot !== null && !gone.has(snapshot)) return snapshot
  }
  return null
}

/** The thread a lane's copy was cloned from, and the state it was cloned at. */
interface ForkParent {
  readonly lane: ThreadId
  readonly point: PointId
}

/**
 * Where `lane`, whose thread ends at `tip`, was cloned from: the nearest state
 * above its first prompt, and the lane that recorded it, which is what
 * `forkSource` clones. Null for a lane that began at its base, with no state
 * above it.
 */
export function forkParent(
  index: TreeIndex,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  lane: ThreadId,
  tip: EntryId | null,
): ForkParent | null {
  const first = laneFirstPrompt(index, revisions, lane, tip)
  const above = first === null ? null : index.parentOf(first)
  if (above === null) return null
  const { point, pointLane } = nearestRevision(index, revisions, {
    kind: "entry",
    id: above,
  })
  return point === null || pointLane === null
    ? null
    : { lane: pointLane, point }
}

/** The files conflicted at `point`, as the records naming it say. */
export function pointConflicts(
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  point: PointId,
): readonly string[] {
  const files = new Set<string>()
  for (const r of revisions.values())
    if (r.point === point) for (const f of r.conflicts) files.add(f)
  return [...files].sort()
}

/**
 * The lane's first prompt on the path to `tip`: the entry nearest the root
 * whose revision record names `lane`. A branch's path passes its parent's
 * prompts first, which name the parent's lane, so this is the branch's own.
 * Null when no run of the lane is on the path.
 */
export function laneFirstPrompt(
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
