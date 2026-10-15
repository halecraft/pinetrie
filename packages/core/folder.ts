// core/folder — a folder project's history as stored and as lanehost carries
// it out: its states, its conflicts, what a path holds, and the steps of a
// merge. `@pinetrie/folder` decides over them; lanehost's disks role does
// what they say, and declares only core and channel.

import type { EntryId, NonEmpty, PointId, ThreadId, WriterId } from "./index.ts"

/** How a folder project's state came to be: what its parents mean. */
export type StateMade =
  /** Your folder, read; the first has no parent. */
  | { readonly kind: "read" }
  /** A lane begun: its one parent is the state its disk was restored from. */
  | { readonly kind: "start"; readonly lane: ThreadId }
  | {
      readonly kind: "turn"
      readonly lane: ThreadId
      readonly entry: EntryId
    }
  /** Its parents: the lane's state before, and the state it merged. */
  | { readonly kind: "catch-up"; readonly lane: ThreadId }
  /** Its parents: your folder's state before, and the lane's tip. */
  | { readonly kind: "accept"; readonly lane: ThreadId }
  /**
   * Your folder set back to `of`'s content. Its one parent is your folder's
   * newest state, never `of`, so your folder's line stays a line.
   */
  | { readonly kind: "restore"; readonly of: PointId }
  /** A virtual base a conflict names; its parents are the bases it merges. */
  | { readonly kind: "bases-merged" }

/** A state of a folder project: its snapshot, its parents, how it was made. */
export interface StateRecord {
  /** Its snapshot's name (`isFolderStateId`). */
  readonly id: PointId
  /** States recorded before it; none only for your folder's first read. */
  readonly parents: readonly PointId[]
  readonly made: StateMade
  readonly at: number
  readonly by: WriterId | null
}

/** A path a merge into a lane left conflicted, with the states of its three versions. */
export interface ConflictRecord {
  readonly lane: ThreadId
  readonly path: string
  /** The merge base: a state, or a `bases-merged` one. */
  readonly base: PointId
  readonly ours: PointId
  readonly theirs: PointId
}

/**
 * A lane's or a snapshot's name on lanehost's disks: one path segment, never
 * `.` or `..`, and never ending in `.tmp`, which a snapshot in the making
 * holds.
 */
export const isDiskName = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.endsWith(".tmp")

/**
 * A folder state's id: a disk name holding a dash, so never a jj commit's
 * (40 hex digits). A turn's state is `turn-<uuidv7>`, never its entry's id,
 * which names the entry's own snapshot; your folder's line's is
 * `line-<uuidv7>`; a virtual base's is `bases-<hash>`.
 */
export const isFolderStateId = (id: string): boolean =>
  id.includes("-") && isDiskName(id) && !/^[0-9a-f]{40}$/.test(id)

/** A state of your folder's line, from a uuidv7 its caller mints. */
export const lineStateId = (uuid: string): PointId => `line-${uuid}` as PointId

/** A turn's state in a folder lane, from a uuidv7 its caller mints. */
export const turnStateId = (uuid: string): PointId => `turn-${uuid}` as PointId

/** What a side holds at a path. */
export type PathFact =
  | { readonly kind: "absent" }
  | {
      readonly kind: "file"
      readonly exec: boolean
      /** No NUL byte in its first 8,000 bytes, as git decides. */
      readonly text: boolean
      readonly size: number
    }
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "dir" }
  /** A device, a socket or a fifo: never merged, always a conflict. */
  | { readonly kind: "other" }

/**
 * One step of a merge into a disk, whose state before it is `ours`. A path
 * only ours changed has no step: the disk holds it already.
 */
export type MergeStep =
  /** Clone theirs' file, or make theirs' symlink again. */
  | { readonly kind: "take"; readonly path: string }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "mode"; readonly path: string; readonly exec: boolean }
  /** `git merge-file` of base, ours and theirs; written only if it differs from ours. */
  | { readonly kind: "text"; readonly path: string }

/**
 * How one merge base is had: a state, or a merge of several made first
 * (git's recursive strategy): `first`, then each `other` merged in over its
 * own base, which is null when the two share no state (an empty base).
 * Every base merged is a state; only the base of an inner merge may be
 * virtual.
 */
export type BasePlan =
  | { readonly kind: "state"; readonly state: PointId }
  | {
      readonly kind: "virtual"
      /** `bases-<hash>` of the sorted ids of every base it folds in. */
      readonly name: PointId
      readonly first: PointId
      readonly merges: NonEmpty<{
        readonly base: BasePlan | null
        readonly other: PointId
      }>
    }

/** A text step of a merge, as lanehost answered it. */
export interface TextMerged {
  readonly path: string
  readonly clean: boolean
}

/**
 * A change to a lane's states directory, which its container sees
 * read-only: the state its offer is computed against (`start`), and each
 * conflict's three versions. The directory goes with its lane's disk.
 */
export type LaneStatesOp =
  /** `start` moved to a read-only copy of `state`. */
  | { readonly kind: "start"; readonly state: PointId }
  /** A conflicted path's three versions, from their states; absent ones have none. */
  | {
      readonly kind: "conflict"
      readonly path: string
      readonly base: PointId
      readonly ours: PointId
      readonly theirs: PointId
    }
  /** A path's versions gone, once it is resolved. */
  | { readonly kind: "resolved"; readonly path: string }
