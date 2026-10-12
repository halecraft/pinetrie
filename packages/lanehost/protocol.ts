// lanehost/protocol — the calls the host makes to lanehost, and their
// results. Every call names its project by key and its disks by name,
// never by path: the server builds each path itself (`layout.ts`).

import type { DiskDiff } from "@pinetrie/core"
import type { Grant } from "./grants.ts"

/** A disk operation on one project's disks; the shape of lanes' `DiskOp`. */
export type DiskCall =
  | {
      readonly kind: "create"
      readonly lane: string
      /** Paths copied from a snapshot into the new disk by reflink; null with none. */
      readonly carry: {
        readonly from: string
        readonly paths: readonly string[]
      } | null
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
  /** A project's snapshots, each with when it was made. */
  | { readonly kind: "snapshots"; readonly project: string }
  /** A file of pine·trie's (`.pinetrie-lane/<file>`) inside a snapshot; null when absent. */
  | {
      readonly kind: "read"
      readonly project: string
      readonly snapshot: string
      readonly file: string
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

/** A snapshot, and when it was made (ms since the epoch). */
export interface SnapshotListed {
  readonly id: string
  readonly made: number
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
  readonly snapshots: readonly SnapshotListed[]
  readonly read: string | null
  readonly record: null
  readonly projects: readonly ProjectListed[]
  readonly removeProject: null
  readonly grant: null
  readonly diff: DiskDiff
}

export type LanehostResult<C extends LanehostCall> = LanehostResults[C["kind"]]

/** The server's hello: the role it serves. */
export interface LanehostHello {
  readonly role: string
}
