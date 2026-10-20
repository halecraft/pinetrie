// folder/proposed — a folder lane's proposed changes and base records, the
// page's caches, from what the graph says now and what the host read of
// the lane's paths.

import type {
  FolderBaseRecord,
  FolderProposedChangesRecord,
  PointId,
  StateRecord,
  ThreadId,
} from "@pinetrie/core"
import { isAncestor, laneStates, shownMergeId } from "./graph.ts"

/**
 * The state a folder proposed changes record shows: its shown merge, or
 * its tip when it holds no work, which has none.
 */
export const shownPoint = (r: FolderProposedChangesRecord): PointId =>
  r.files.length === 0 ? r.tip : shownMergeId(r.start, r.tip)

/** What building a lane's proposed changes reads, decided from the graph. */
export type ShownMergePlan =
  /** A lane not begun, or a project before its first read: none to show. */
  | { readonly kind: "withdraw" }
  | {
      readonly kind: "build"
      readonly newest: PointId
      readonly tip: PointId
      readonly start: PointId
      /** Accepted work holds the tip already: nothing to merge, and nothing to show. */
      readonly holds: boolean
      /** The state the proposed changes are read against: the shown merge, or accepted work's newest when it holds the tip. */
      readonly shown: PointId
    }

/** `lane`'s proposed changes to build from what the graph says now. */
export function planShownMerge(
  states: readonly StateRecord[],
  lane: ThreadId,
): ShownMergePlan {
  const { graph, newest, tip, start } = laneStates(states, lane)
  if (newest === null || tip === null || start === null)
    return { kind: "withdraw" }
  const holds = isAncestor(graph, tip, newest)
  return {
    kind: "build",
    newest,
    tip,
    start,
    holds,
    shown: holds ? newest : shownMergeId(newest, tip),
  }
}

/**
 * A lane's proposed changes and base records from what the graph says now; null
 * for a lane that has not begun, or a project before its first read.
 */
export function planFolderRecords(input: {
  readonly lane: ThreadId
  readonly states: readonly StateRecord[]
  /** The proposed changes' files: the source paths differing between accepted work's newest and the shown merge. */
  readonly files: readonly string[]
  /** What catching up would change in the lane: the source paths differing between its newest and the shown merge. */
  readonly brings: readonly string[]
  /** Whether the lane changed anything since its start. */
  readonly worked: boolean
  readonly conflicts: readonly string[]
  readonly before: FolderProposedChangesRecord | undefined
  readonly now: number
}): {
  readonly proposed: FolderProposedChangesRecord
  readonly base: FolderBaseRecord
  /**
   * The shown merge the new record replaces, to delete; null when none, or
   * when an accept made it a state. Only an accept records a shown merge,
   * on the project's queue, where proposed changes are built too.
   */
  readonly drop: PointId | null
} | null {
  const { graph, newest, tip, start } = laneStates(input.states, input.lane)
  if (newest === null || tip === null || start === null) return null
  const { before } = input
  const proposed: FolderProposedChangesRecord = {
    kind: "folder",
    lane: input.lane,
    start: newest,
    tip,
    files: input.files,
    conflicts: input.conflicts,
    // A description holds while it describes the same two states.
    description:
      before?.start === newest && before.tip === tip
        ? before.description
        : null,
    at: input.now,
  }
  const was =
    before === undefined || before.files.length === 0
      ? null
      : shownMergeId(before.start, before.tip)
  return {
    drop:
      was !== null && was !== shownPoint(proposed) && !graph.states.has(was)
        ? was
        : null,
    proposed,
    base: {
      kind: "folder",
      lane: input.lane,
      start,
      getLatest:
        start === newest ? null : { tip, to: newest, files: input.brings },
      work: input.worked ? "some" : "none",
    },
  }
}
