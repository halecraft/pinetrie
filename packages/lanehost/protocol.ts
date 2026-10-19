// lanehost/protocol — the calls the host makes to lanehost, and their
// results. Every call names its project by key and its disks by name,
// never by path: the server builds each path itself (`layout.ts`).

import type {
  DiffStat,
  DiskDiff,
  LaneStatesOp,
  MergeStep,
  PathFact,
  PathPair,
  ReadInAnswer,
  ReadPath,
  TextMerged,
} from "@pinetrie/core"
import type { Grant } from "./grants.ts"

/** A disk operation on one project's disks; the shape of lanes' `DiskOp`. */
export type DiskCall =
  | {
      readonly kind: "create"
      readonly lane: string
    }
  | { readonly kind: "restore"; readonly lane: string; readonly from: string }
  | {
      readonly kind: "snapshot"
      readonly lane: string
      readonly snapshot: string
    }
  | { readonly kind: "delete"; readonly lane: string }
  | { readonly kind: "delete-snapshots"; readonly ids: readonly string[] }

export type LanehostCall =
  | { readonly kind: "disk"; readonly project: string; readonly op: DiskCall }
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
  /** A folder lane's states directory, made if missing, for its container to mount. */
  | {
      readonly kind: "states-dir"
      readonly project: string
      readonly lane: string
    }
  /**
   * A nested lane's inner lanes' subvolume, made if missing, the rootless
   * user's; and its inner Docker data root in it, a clone of
   * `cloneFromLane`'s when that one is there, else its own, made a subvolume
   * when it is not one.
   */
  | {
      readonly kind: "nested-disk"
      readonly project: string
      readonly lane: string
      readonly cloneFromLane: string | null
    }
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
  /** A project's disks, all of them, and its directory. */
  | { readonly kind: "remove-project"; readonly project: string }
  /** A project's grant of the host's ports, replacing its last (`grants.ts`). */
  | ({ readonly kind: "grant" } & Grant)
  /** What differs between two of a project's snapshots, both read-only (`diff.ts`). */
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

/** What each call answers. */
export interface LanehostResults {
  readonly disk: null
  readonly "disk-exists": boolean
  readonly "snapshot-exists": boolean
  readonly snapshots: readonly string[]
  readonly "nested-disk": null
  readonly "states-dir": null
  readonly read: string | null
  readonly record: null
  readonly projects: readonly ProjectListed[]
  readonly "remove-project": null
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
}

export type LanehostResult<C extends LanehostCall> = LanehostResults[C["kind"]]

/** The server's hello: the role it serves. */
export interface LanehostHello {
  readonly role: string
}
