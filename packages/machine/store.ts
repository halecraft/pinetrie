// machine/store — what the disk upkeep reads of the store and the host's
// records, and what it has done, as ports. The host composes them from
// lanehost's calls, the runtime and the documents.

import type { Deletable, ThreadId } from "@pinetrie/core"
import type { SnapshotRow } from "./snapshot-index.ts"

/** A project's store as listed: names alone, never stat'ed. */
export interface StoreListed {
  readonly snapshots: readonly string[]
  readonly lanes: readonly string[]
  /** Each nested lane's inner projects, with the root each recorded. */
  readonly nested: readonly {
    readonly lane: string
    readonly projects: readonly {
      readonly key: string
      readonly root: string | null
    }[]
  }[]
}

/** What the upkeep does to the store. Each succeeds when there is nothing to do. */
export interface StoreControls {
  listing(): Promise<StoreListed>
  deleteSnapshots(ids: readonly Deletable<"entry">[]): Promise<void>
  /** A lane's container, if any, and its disk. */
  deleteLane(lane: ThreadId): Promise<void>
  /** An inner project of `lane`'s nested store, by its key. */
  removeInnerProject(lane: string, key: string): Promise<void>
}

/** A snapshot a revision record names: what the index's fill writes `kept`. */
export type RecordedSnapshot = Pick<
  SnapshotRow,
  "snapshot" | "lane" | "changed"
>

/** What the upkeep reads of the host's records and lanes. */
export interface StoreRecords {
  /** Every root's id. */
  roots(): Promise<readonly string[]>
  /** The entry snapshots a root's revision records name. */
  snapshotsOf(root: string): Promise<readonly RecordedSnapshot[]>
  /** Lanes that will run again: each with a record, in no archived canvas. */
  liveLanes(): Promise<ReadonlySet<ThreadId>>
  /** Lanes whose container runs now. */
  runningLanes(): Promise<ReadonlySet<string>>
}
