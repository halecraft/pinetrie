// lanehost/protocol — the calls the host makes to lanehost, and their
// results. Every call names its project by key and its disks by name,
// never by path: the server builds each path itself (`layout.ts`).

import type {
  DiskDiff,
  LaneStatesOp,
  MergeStep,
  PathFact,
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
  | { readonly kind: "deleteSnapshots"; readonly ids: readonly string[] }

export type LanehostCall =
  | { readonly kind: "disk"; readonly project: string; readonly op: DiskCall }
  | {
      readonly kind: "diskExists"
      readonly project: string
      readonly lane: string
    }
  | {
      readonly kind: "snapshotExists"
      readonly project: string
      readonly snapshot: string
    }
  /** A nested lane's inner lanes' subvolume, made if missing, the rootless user's. */
  | {
      readonly kind: "nestedDisk"
      readonly project: string
      readonly lane: string
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
  | { readonly kind: "removeProject"; readonly project: string }
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
      readonly kind: "pathFacts"
      readonly project: string
      readonly snapshot: string
      readonly paths: readonly string[]
    }
  /** The paths where two snapshots hold files of alike content. */
  | {
      readonly kind: "sameContent"
      readonly project: string
      readonly a: string
      readonly b: string
      readonly paths: readonly string[]
    }
  /**
   * A merge's steps applied to a disk (a lane's, or a virtual base's
   * scratch disk) over `base` (null: an empty one) from `theirs`; answers
   * each text step clean or conflicted. With `markers`, a conflicted text
   * keeps git's markers; else ours.
   */
  | {
      readonly kind: "applyMerge"
      readonly project: string
      readonly disk: string
      readonly base: string | null
      readonly theirs: string
      readonly steps: readonly MergeStep[]
      readonly markers: boolean
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
  readonly diskExists: boolean
  readonly snapshotExists: boolean
  readonly nestedDisk: null
  readonly read: string | null
  readonly record: null
  readonly projects: readonly ProjectListed[]
  readonly removeProject: null
  readonly grant: null
  readonly diff: DiskDiff
  readonly pathFacts: readonly PathFact[]
  readonly sameContent: readonly string[]
  readonly applyMerge: readonly TextMerged[]
  readonly states: null
}

export type LanehostResult<C extends LanehostCall> = LanehostResults[C["kind"]]

/** The server's hello: the role it serves. */
export interface LanehostHello {
  readonly role: string
}
