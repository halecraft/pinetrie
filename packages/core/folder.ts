// core/folder — a folder project's history as stored and as lanehost carries
// it out: its states, its conflicts, what a path holds, and the steps of a
// merge. `@pinetrie/folder` decides over them; lanehost's disks role does
// what they say, and declares only core and channel.

import type { EntryId, NonEmpty, PointId, ThreadId, WriterId } from "./index.ts"

/** How a folder project's state came to be: what its parents mean. */
export type StateMade =
  /** The project's folder, read; the first has no parent. */
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
  /** Its parents: accepted work's state before, and the lane's tip. */
  | { readonly kind: "accept"; readonly lane: ThreadId }
  /**
   * The project's folder set back to `of`'s content. Its one parent is
   * accepted work's newest state, never `of`, so accepted work's line stays a
   * line.
   */
  | { readonly kind: "restore"; readonly of: PointId }
  /** A virtual base a conflict names; its parents are the bases it merges. */
  | { readonly kind: "bases-merged" }
  /**
   * A write through a file an app held across an accept, which landed in
   * the file the accept moved aside: its one parent is the accept's state,
   * with `path` holding what the aside held. Never on accepted work's line.
   */
  | { readonly kind: "concurrent"; readonly path: string }

/** A state of a folder project: its snapshot, its parents, how it was made. */
export interface StateRecord {
  /** Its snapshot's name (`isFolderStateId`). */
  readonly id: PointId
  /** States recorded before it; none only for the first read of the project's folder. */
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
 * (40 hex digits). A lane's states are `start-`, `turn-` and
 * `catch-up-<uuidv7>`, never its entry's id, which names the entry's own
 * snapshot; accepted work's line's are `line-<uuidv7>`; a virtual base's is
 * `bases-<hash>`.
 */
export const isFolderStateId = (id: string): boolean =>
  id.includes("-") && isDiskName(id) && !/^[0-9a-f]{40}$/.test(id)

/** A state of accepted work's line, from a uuidv7 its caller mints. */
export const lineStateId = (uuid: string): PointId => `line-${uuid}` as PointId

/** A turn's state in a folder lane, from a uuidv7 its caller mints. */
export const turnStateId = (uuid: string): PointId => `turn-${uuid}` as PointId

/** A folder lane's start state, from a uuidv7 its caller mints. */
export const startStateId = (uuid: string): PointId =>
  `start-${uuid}` as PointId

/** A folder lane's catch-up state, from a uuidv7 its caller mints. */
export const catchUpStateId = (uuid: string): PointId =>
  `catch-up-${uuid}` as PointId

/** A concurrent save's state, from a uuidv7 its caller mints. */
export const concurrentStateId = (uuid: string): PointId =>
  `concurrent-${uuid}` as PointId

/**
 * The prefixes of the names an accept makes at the project's folder's root,
 * and nowhere else: its staging directory and its directory of asides. A
 * scan never enters them; deeper down, such a name is an ordinary source
 * path.
 */
export const FOLDER_RESERVED = {
  stage: ".pinetrie-accept-",
  aside: ".pinetrie-aside-",
} as const

/** Whether a path from the folder's root lies under a name an accept reserves, or one of `which`. */
export const isFolderReserved = (
  path: string,
  which: keyof typeof FOLDER_RESERVED | "any" = "any",
): boolean => {
  const top = path.split("/", 1)[0] ?? ""
  return (
    which === "any" ? Object.values(FOLDER_RESERVED) : [FOLDER_RESERVED[which]]
  ).some(p => top.startsWith(p))
}

/** The accept `id`'s staging directory, from the folder's root. */
export const acceptStageDir = (id: string): string =>
  `${FOLDER_RESERVED.stage}${id}`

/** The accept `id`'s directory of asides, from the folder's root. */
export const acceptAsideDir = (id: string): string =>
  `${FOLDER_RESERVED.aside}${id}`

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
 * A change to a lane's states directory, which its container sees read-only:
 * the state its proposed changes are computed against (`start`), and each
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

/**
 * A source path of the project's folder as a read stamps it, by `lstat`: a file or a
 * symlink, never a directory (a directory is the paths under it). Size and
 * ctime are what the lane VM reads alike, so a stamp the host read
 * is the one the disks role checks.
 */
export interface FolderStamp {
  readonly kind: "file" | "symlink"
  readonly size: number
  /** The ctime in ns, as a decimal string: a bigint, past a safe integer. */
  readonly ctimeNs: string
  readonly exec: boolean
  /** A symlink's target. */
  readonly target?: string
}

/** A file's lines added and removed between two states; 0 and 0 for a binary file. */
export interface DiffStat {
  readonly path: string
  readonly added: number
  readonly removed: number
}

/**
 * One path an accept writes: what the folder held there when the accept
 * read it, and what the merged state holds.
 */
export interface AcceptWrite {
  readonly path: string
  /** Null for none. */
  readonly expected: FolderStamp | null
  /** Null to delete it. */
  readonly to:
    | { readonly kind: "file" }
    | { readonly kind: "symlink"; readonly target: string }
    | null
}

/**
 * A file's inode, size and mtime, by `lstat`: what proves it the same
 * file, unwritten, across a rename, which changes its ctime but none of
 * these. A target's just before its move aside; a staged file's.
 */
export interface InodeStat {
  readonly ino: number
  readonly size: number
  /** In ns, as a decimal string. */
  readonly mtimeNs: string
}

/**
 * One path of an accept as its journal records it. Each field is written
 * before the step it names, so a host stopped at any point finds, for
 * each path, everything it may have to undo.
 */
export interface AcceptPath {
  readonly path: string
  /** Its aside, from the folder's root, once it is to be moved; null before, or for a new path. */
  readonly aside: string | null
  /** The target's `lstat` just before its move. */
  readonly moved: InodeStat | null
  /**
   * The staged file's stat, once it is to be linked: what proves a target
   * pine·trie's, and nobody's written in place since.
   */
  readonly staged: InodeStat | null
  /** A symlink's target, once it is to be made: its proof in place of an inode. */
  readonly symlink: string | null
  /** Written after its link, or after its aside for a delete. */
  readonly linked: boolean
  /**
   * Once the accept ends with its aside kept: the line state a concurrent
   * save of it is made on (the accept's state, or on a put back accepted
   * work's newest), and the aside is the folder's next reads' to check.
   */
  readonly keptOn: PointId | null
}

/** An accept as its journal records it, from before its first move to its end. */
export interface AcceptJournal {
  /** A uuid, which names its staging directory and its asides' directory. */
  readonly id: string
  readonly lane: ThreadId
  /** The accept's state, its snapshot made: recorded only once every path is linked. */
  readonly record: StateRecord
  readonly paths: readonly AcceptPath[]
  /** `open` until it ends, accepted or put back. */
  readonly status: "open" | "accepted" | "put-back"
}

/** A path a read copies into accepted work's line, with the stamp the host read. */
export interface ReadPath {
  readonly path: string
  /**
   * The path in the project's folder copied to `path`, when another: a
   * kept aside, read into a concurrent save.
   */
  readonly source?: string
  readonly stamp: Pick<FolderStamp, "size" | "ctimeNs">
}

/**
 * What a read into accepted work's line answered: its state made, or the
 * paths whose stamp moved during their copy, and no state.
 */
export type ReadInAnswer =
  | { readonly kind: "made" }
  | { readonly kind: "moved"; readonly paths: readonly string[] }
