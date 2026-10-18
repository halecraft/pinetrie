// core/lanes — a lane as recorded: its own or a foreign one, whether it fits
// the project, and the proof that it may run; and what the host found where
// it runs.

import type { ProjectKind } from "./config.ts"
import type { RootId, ThreadId, WriterId } from "./ids.ts"

/**
 * A lane's record: a host-written `pinetrie.lane` value keyed by the lane's
 * name, written once, when the lane is created. The setting never changes: a
 * lane's files would stop matching its conversation.
 */
export interface LaneRecord {
  readonly lane: ThreadId
  /** The root the lane works in. */
  readonly root: RootId
  /**
   * The kind of history its own copy keeps, in its container, for its whole
   * life: its disk holds a jj repo or it does not. Null for a lane a host
   * without tools made, which has no copy of its own.
   */
  readonly history: ProjectKind | null
  readonly by: WriterId
  readonly createdAt: number
}

/** A lane with a copy of its own. */
export type OwnLane = LaneRecord & { readonly history: ProjectKind }

/** The record as an `OwnLane`; null for a lane with no copy of its own. */
export const ownLane = (record: LaneRecord): OwnLane | null =>
  record.history === null ? null : (record as OwnLane)

/**
 * A lane whose history is not the project's kind: made before the project
 * changed kind. Kept whole, and refused before anything runs on it.
 */
export interface ForeignLane {
  readonly kind: "foreign"
  readonly lane: ThreadId
  readonly history: ProjectKind
}

/** Null when `lane` keeps a history of `kind`, else why it does not fit. */
export const laneFits = (
  lane: OwnLane,
  kind: ProjectKind,
): ForeignLane | null =>
  lane.history === kind
    ? null
    : { kind: "foreign", lane: lane.lane, history: lane.history }

declare const runnableBrand: unique symbol
/** A lane a run may start on (`proveRunnable`, its one maker). */
export type RunnableLane = ThreadId & { readonly [runnableBrand]: true }

/**
 * `lane` as one a run may start on, or why not. A lane with no record or no
 * copy of its own runs with no tools, and so does every lane on a host with
 * no tools (`kind` null); a lane with its own copy must fit `kind`.
 */
export function proveRunnable(
  lane: ThreadId,
  record: LaneRecord | undefined,
  kind: ProjectKind | null,
): RunnableLane | ForeignLane {
  const own = record === undefined ? null : ownLane(record)
  const foreign = own === null || kind === null ? null : laneFits(own, kind)
  return foreign ?? (lane as RunnableLane)
}

/**
 * What the host found where it runs: a host-written `pinetrie.project` value,
 * rewritten at every start, and only by a host with tools, whose every lane has
 * its own copy.
 */
export interface ProjectRecord {
  readonly root: string
  /** What the project's folder was at this start: what a lane's history must be to run. */
  readonly kind: ProjectKind
  /**
   * Whom the host's config names its owner (`owner`): who answers when
   * a lane asks for their ssh identity. Null with none.
   */
  readonly owner: WriterId | null
}
