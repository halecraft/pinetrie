// lanes/runtime-port — what a runtime does for lanes. Planners return
// values (`ContainerShape`, `DiskOp`); a runtime turns them into commands. The host picks the runtime and hands it in.

import type { DiskDiff, LaneObservation, SnapshotId } from "@pinetrie/core"
import type { ContainerShape, ImagePlan, LaneOwner } from "./plan.ts"
import type { Ran } from "./run.ts"

/**
 * A lane's disk, as the host asks of whichever runtime keeps it. `delete`
 * and `deleteSnapshots` succeed when there is nothing to delete.
 */
export type DiskOp =
  | {
      readonly kind: "create"
      readonly lane: LaneOwner
    }
  | {
      readonly kind: "restore"
      readonly lane: LaneOwner
      readonly from: SnapshotId
    }
  | {
      readonly kind: "snapshot"
      readonly lane: LaneOwner
      readonly snapshot: SnapshotId
    }
  | { readonly kind: "delete"; readonly lane: LaneOwner }
  | { readonly kind: "deleteSnapshots"; readonly ids: readonly SnapshotId[] }

/** What a step asks of the runtime: a disk operation, or a lane's container made and started. */
export type RuntimeOp =
  | DiskOp
  | { readonly kind: "run"; readonly shape: ContainerShape }

/** A container's state and spec label (`SPEC_LABEL`), as its runtime reports them. */
export interface ContainerFacts {
  readonly state: "running" | "stopped" | "missing"
  /** Its spec label, or null when it has none. */
  readonly label: string | null
}

/** Every call the host makes to a runtime. Each throws on failure, naming the command. */
export interface LaneRuntime {
  disk(op: DiskOp): Promise<void>
  diskExists(lane: LaneOwner): Promise<boolean>
  snapshotExists(id: SnapshotId): Promise<boolean>
  /** What differs between two snapshots, both of this project's. */
  diff(from: SnapshotId, to: SnapshotId): Promise<DiskDiff>
  /** This project's snapshots, each with when it was made (ms since the epoch). */
  snapshots(): Promise<
    readonly { readonly id: string; readonly made: number }[]
  >
  /** A file of pine·trie's own (`.pinetrie-lane/<file>`) in a snapshot; null when absent. */
  readLaneFile(snapshot: SnapshotId, file: string): Promise<string | null>
  /** The container's spec as the runtime makes it, without its label: pure. Its hash is its spec label. */
  runSpec(shape: ContainerShape): unknown
  /** Make the container from `shape`, labelled with its spec hash, and start it. */
  run(shape: ContainerShape): Promise<void>
  containerFacts(container: string): Promise<ContainerFacts>
  /**
   * The running container's runs, observed from now: its first process
   * registered with the machine's observer, `shared` its shared
   * directories as the lane sees them. Throws, saying why, where nothing
   * can observe lanes.
   */
  observe(
    container: string,
    shared: readonly string[],
  ): Promise<LaneObservation>
  start(container: string): Promise<void>
  /** Stop it; its disk stays as it is. */
  stop(container: string): Promise<void>
  /** Delete the container, running or not; its disk stays. Succeeds when there is none. */
  remove(container: string): Promise<void>
  /** `argv` run in a running container with stdin attached (`exec -i`). */
  execArgv(container: string, argv: readonly string[]): readonly string[]
  imageExists(tag: string): Promise<boolean>
  buildImage(plan: ImagePlan): Promise<void>
  /** The image's own `PATH`. */
  imagePath(tag: string): Promise<string>
  /** `argv` in a throwaway container of `tag`; its stdout as bytes. */
  runInImage(tag: string, argv: readonly string[]): Promise<Ran<Uint8Array>>
}
