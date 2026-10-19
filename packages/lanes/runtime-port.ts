// lanes/runtime-port — what a runtime does for lanes. Planners return
// values (`ContainerShape`, `DiskOp`); a runtime turns them into commands. The host picks the runtime and hands it in.

import type {
  DiskOp as CoreDiskOp,
  DiskDiff,
  FoldNotices,
  LaneObservation,
  SnapshotId,
} from "@pinetrie/core"
import type { ImagePlan } from "./image-plan.ts"
import type { Ran } from "./run.ts"
import type { ContainerShape } from "./shape.ts"
import type { LaneOwner } from "./spec.ts"
import type { PlannedStart } from "./steps.ts"

/** A lane's disk, as the host asks of whichever runtime keeps it (core's `DiskOp`). */
export type DiskOp = CoreDiskOp<LaneOwner>

/**
 * What a step asks of the runtime: a disk operation, a lane's container made
 * and started, or a container deleted (`LaneRuntime.remove`).
 */
export type RuntimeOp =
  | DiskOp
  | { readonly kind: "run"; readonly start: PlannedStart }
  | { readonly kind: "remove"; readonly container: string }

/** A container's state and spec label (`SPEC_LABEL`), as its runtime reports them. */
export interface ContainerFacts {
  readonly state: "running" | "stopped" | "missing"
  /** Its spec label, or null when it has none. */
  readonly label: string | null
}

/**
 * A project's lane disks and their snapshots. A disk is a directory on the
 * runtime's machine, made by whatever keeps the disks (lanehost's
 * `lanehostDisks`) and bound into the lane's container by the runtime.
 * Each call throws on failure, naming the command.
 */
export interface LaneDisks {
  disk(op: DiskOp): Promise<void>
  diskExists(lane: LaneOwner): Promise<boolean>
  snapshotExists(id: SnapshotId): Promise<boolean>
  /** Every snapshot of the project's, sorted: one call, where a check of each would be many. */
  snapshots(): Promise<readonly SnapshotId[]>
  /** What differs between two snapshots, both of this project's. */
  diff(from: SnapshotId, to: SnapshotId): Promise<DiskDiff>
  /** A file of pine·trie's own (`.pinetrie-lane/<file>`) in a snapshot; null when absent. */
  readLaneFile(snapshot: SnapshotId, file: string): Promise<string | null>
}

/** A lane's container, on its disk. Each call throws on failure, naming the command. */
export interface LaneContainers {
  /** The container's spec as the runtime makes it, without its label: pure. Its hash is its spec label. */
  runSpec(shape: ContainerShape): unknown
  /**
   * Make the container from `shape`, labelled with its spec hash, and start
   * it. The folders it binds are there already: its start's plan made them
   * (`planStart`).
   */
  run(shape: ContainerShape): Promise<void>
  containerFacts(container: string): Promise<ContainerFacts>
  start(container: string): Promise<void>
  /** Stop it; its disk stays as it is. */
  stop(container: string): Promise<void>
  /** Delete the container, running or not; its disk stays. Succeeds when there is none. */
  remove(container: string): Promise<void>
  /** `argv` run in a running container with stdin attached (`exec -i`). */
  execArgv(container: string, argv: readonly string[]): readonly string[]
}

/** The images lanes run. Each call throws on failure, naming the command. */
export interface LaneImages {
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

/** Every call the host makes to a runtime. */
export interface LaneRuntime extends LaneDisks, LaneContainers, LaneImages {}

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
