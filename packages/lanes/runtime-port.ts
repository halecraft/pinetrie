// lanes/runtime-port — what a runtime does for lanes. Planners return
// values (`ContainerShape`, `DiskOp`); a runtime turns them into commands. The host picks the runtime and hands it in.

import type {
  DiskDiff,
  FoldNotices,
  LaneObservation,
  SnapshotId,
} from "@pinetrie/core"
import type { ContainerShape, ImagePlan, LaneOwner } from "./plan.ts"
import type { Ran } from "./run.ts"

/**
 * A lane's disk, as the host asks of whichever runtime keeps it. `delete`
 * and `delete-snapshots` succeed when there is nothing to delete.
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
  | { readonly kind: "delete-snapshots"; readonly ids: readonly SnapshotId[] }
  /**
   * A nested lane's inner Docker data root: a clone of `cloneFromLane`'s in
   * place of its own when that one is there, else its own as it is. Only
   * while the lane's container is stopped or not yet made.
   */
  | {
      readonly kind: "inner-docker-data-root"
      readonly lane: LaneOwner
      readonly cloneFromLane: LaneOwner | null
    }

/**
 * What a step asks of the runtime: a disk operation, a lane's container made
 * and started, or a container deleted (`LaneRuntime.remove`).
 */
export type RuntimeOp =
  | DiskOp
  | { readonly kind: "run"; readonly shape: ContainerShape }
  | { readonly kind: "remove"; readonly container: string }

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
  /** Every snapshot of the project's, sorted: one call, where a check of each would be many. */
  snapshots(): Promise<readonly SnapshotId[]>
  /** What differs between two snapshots, both of this project's. */
  diff(from: SnapshotId, to: SnapshotId): Promise<DiskDiff>
  /** A file of pine·trie's own (`.pinetrie-lane/<file>`) in a snapshot; null when absent. */
  readLaneFile(snapshot: SnapshotId, file: string): Promise<string | null>
  /** The container's spec as the runtime makes it, without its label: pure. Its hash is its spec label. */
  runSpec(shape: ContainerShape): unknown
  /** Make the container from `shape`, labelled with its spec hash, and start it. */
  run(shape: ContainerShape): Promise<void>
  containerFacts(container: string): Promise<ContainerFacts>
  start(container: string): Promise<void>
  /** Stop it; its disk stays as it is. */
  stop(container: string): Promise<void>
  /** Delete the container, running or not; its disk stays. Succeeds when there is none. */
  remove(container: string): Promise<void>
  /** `argv` run in a running container with stdin attached (`exec -i`). */
  execArgv(container: string, argv: readonly string[]): readonly string[]
  /**
   * The lane images a host needs: each built unless the runtime has it. The
   * runtime keeps them as needed, removes its other images of pine·trie's
   * that nothing uses after any build, and builds one again when a
   * container is made from it after another host removed it.
   */
  ensureLaneImages(plans: readonly ImagePlan[]): Promise<void>
  /** The image's own `PATH`. */
  imagePath(tag: string): Promise<string>
  /** `argv` in a throwaway container of `tag`; its stdout as bytes. */
  runInImage(tag: string, argv: readonly string[]): Promise<Ran<Uint8Array>>
}

/** An image the runtime builds, announced before its build. */
export type ImageBuild = "lane" | "lanehost" | "observer"

/** The machine's observer, connected: the one way to observe a lane. */
export interface Observer {
  /**
   * The running container's runs, observed from now: its first process
   * registered with the observer, `shared` its shared directories as the
   * lane sees them, and its notices folded by `fold` as they arrive.
   */
  observe(
    container: string,
    shared: readonly string[],
    fold: FoldNotices,
  ): Promise<LaneObservation>
}

/** A runtime whose slot is served: what is reached only once it is. */
export interface Served {
  /**
   * The observer's image built unless the runtime has it, its container
   * running, and this host's connection to it held while the host runs.
   * Rejects, saying why, where it cannot load.
   */
  observer(): Promise<Observer>
}
