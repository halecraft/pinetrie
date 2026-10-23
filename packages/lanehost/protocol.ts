// lanehost/protocol — the calls the host makes to lanehost, and their
// results. Every call names its project by key and its disks by name,
// never by path: the server builds each path itself (`layout.ts`).

import type {
  DiffStat,
  DiskDiff,
  DiskOp,
  LaneStatesOp,
  MergeStep,
  PathFact,
  PathPair,
  ReadInAnswer,
  ReadPath,
  TextMerged,
} from "@pinetrie/core"
import type { Grant } from "./grants.ts"
import type { MachineRead } from "./machine.ts"

export type LanehostCall =
  | { readonly kind: "disk"; readonly project: string; readonly op: DiskOp }
  | {
      readonly kind: "disk-exists"
      readonly project: string
      readonly lane: string
    }
  | {
      readonly kind: "snapshot-exists"
      readonly project: string
      readonly snapshot: string
    }
  /** The names of the project's snapshots, sorted: one listing for what a sweep keeps. */
  | { readonly kind: "snapshots"; readonly project: string }
  /**
   * A file inside a snapshot, by its path from the snapshot's root; null
   * when absent. Refused when it leaves the snapshot or holds more than
   * `limit` bytes.
   */
  | {
      readonly kind: "read"
      readonly project: string
      readonly snapshot: string
      readonly path: string
      readonly limit: number
    }
  /** The project's root, kept beside its disks for the sweep. */
  | { readonly kind: "record"; readonly project: string; readonly root: string }
  /** Every project in the lanes directory, with the root it recorded. */
  | { readonly kind: "projects" }
  /**
   * A project's disks, all of them, and its directory; `within`, an inner
   * project in a nested lane's store: `project` is the inner one's key.
   */
  | {
      readonly kind: "remove-project"
      readonly project: string
      readonly within?: NestedStore
    }
  /** What a project's store holds, by directory listings alone (`StoreListing`). */
  | { readonly kind: "store-listing"; readonly project: string }
  /** A project's grant of the host's ports, replacing its last (`grants.ts`). */
  | ({ readonly kind: "grant" } & Grant)
  /** What differs between two of a project's snapshots, both read-only (`btrfs.ts`, `walk.ts`). */
  | {
      readonly kind: "diff"
      readonly project: string
      readonly from: string
      readonly to: string
    }

  /** What a snapshot holds at each path, in the order asked (`folder.ts`). */
  | {
      readonly kind: "path-facts"
      readonly project: string
      readonly snapshot: string
      readonly paths: readonly string[]
    }
  /** The files and symlinks a snapshot holds at or under each path. */
  | {
      readonly kind: "files-under"
      readonly project: string
      readonly snapshot: string
      readonly paths: readonly string[]
    }
  /** One file's unified diff between two snapshots, cut past `limit` bytes. */
  | {
      readonly kind: "file-diff"
      readonly project: string
      readonly a: string
      readonly b: string
      readonly path: string
      readonly limit: number
    }
  /** Lines added and removed in each path between two snapshots. */
  | {
      readonly kind: "diff-stats"
      readonly project: string
      readonly a: string
      readonly b: string
      readonly paths: readonly string[]
    }
  /** The pairs of paths, `a`'s in one snapshot and `b`'s in another, whose files hold alike bytes. */
  | {
      readonly kind: "same-content"
      readonly project: string
      readonly a: string
      readonly b: string
      readonly pairs: readonly PathPair[]
    }
  /**
   * A merge's steps applied to a disk (a lane's, or a virtual base's
   * scratch disk) over `base` (null: an empty one) from `theirs`; answers
   * each text step clean or conflicted. With `markers`, a conflicted text
   * keeps git's markers; else ours.
   */
  | {
      readonly kind: "apply-merge"
      readonly project: string
      readonly disk: string
      readonly base: string | null
      readonly theirs: string
      readonly steps: readonly MergeStep[]
      readonly markers: boolean
    }
  /**
   * The project's folder's paths read into a new state of its line (`folder.ts`):
   * made from `from` (null: empty), `deleted` removed, `paths` copied from
   * the folder's mount, each checked against its stamp.
   */
  | {
      readonly kind: "read-in"
      readonly project: string
      readonly from: string | null
      readonly state: string
      readonly paths: readonly ReadPath[]
      readonly deleted: readonly string[]
    }
  /**
   * The machine's memory and pressure, the lanes directory's room, and each
   * container's cgroup, by its full id (`machine.ts`).
   */
  | { readonly kind: "machine-sample"; readonly containers: readonly string[] }
  /** A change to a lane's states directory (`<project>/states/<lane>`). */
  | {
      readonly kind: "states"
      readonly project: string
      readonly lane: string
      readonly op: LaneStatesOp
    }

/** A project in the lanes directory; its root is null when none was recorded. */
export interface ProjectListed {
  readonly key: string
  readonly root: string | null
}

/** A nested lane's store: the lanes directory its inner hosts keep their projects in. */
export interface NestedStore {
  /** The outer project's key. */
  readonly project: string
  readonly lane: string
}

/**
 * A project's store, listed. The names are read by a listing alone, never
 * stat'ed (a stat of each held a listing for 9 s cold): a deletion
 * by name needs no proof a name is a subvolume. A name in the making
 * (`.tmp`), or no disk's, is left out, so none reaches an owner.
 */
export interface StoreListing {
  readonly snapshots: readonly string[]
  /** Its lanes' disks: `folder-line`, a read's working disk, is none. */
  readonly lanes: readonly string[]
  /** Each nested lane's inner projects, with the root each recorded. */
  readonly nested: readonly {
    readonly lane: string
    readonly projects: readonly ProjectListed[]
  }[]
}

/** What each call answers. */
export interface LanehostResults {
  readonly disk: null
  readonly "disk-exists": boolean
  readonly "snapshot-exists": boolean
  readonly snapshots: readonly string[]
  readonly read: string | null
  readonly record: null
  readonly projects: readonly ProjectListed[]
  readonly "remove-project": null
  readonly "store-listing": StoreListing
  readonly grant: null
  readonly diff: DiskDiff
  readonly "path-facts": readonly PathFact[]
  readonly "same-content": readonly PathPair[]
  readonly "files-under": readonly string[]
  readonly "file-diff": string
  readonly "diff-stats": readonly DiffStat[]
  readonly "apply-merge": readonly TextMerged[]
  readonly states: null
  readonly "read-in": ReadInAnswer
  readonly "machine-sample": MachineRead
}

export type LanehostResult<C extends LanehostCall> = LanehostResults[C["kind"]]

/** The server's hello: the role it serves. */
export interface LanehostHello {
  readonly role: string
  /**
   * Why this server serves nothing: its project's lock is another host's,
   * or could not be taken. Null when it serves.
   */
  readonly refused: string | null
}
