// machine/ports — what the manager needs done, said as what is meant, never
// as a file's name. The host composes each from the adapters' raw calls.

import type {
  EventMeasured,
  MachineHealth,
  SnapshotId,
  ThreadId,
} from "@pinetrie/core"
import type {
  DecisionMeasured,
  LaneMeasured,
  SampleMeasured,
} from "./measurements.ts"
import type { RepairOutcome, RepairRead, RepairState } from "./repair.ts"
import type { MachineReading, SensedSample } from "./sample.ts"
import type { LaneActivity } from "./treatments.ts"

export interface MachineSensor {
  sample(): Promise<SensedSample>
}

/** What the host knows of its lanes that no sample reads. */
export interface HostLaneFacts {
  /** `lanes`, most important first (`rankLanes`). */
  lanesByImportance(lanes: readonly ThreadId[]): Promise<readonly ThreadId[]>
  /** The program of the `bash` call `lane` runs now; null between calls. */
  programInFlight(lane: ThreadId): string | null
}

/**
 * Where the measurements go: the host's store, which stamps each row with
 * its clock and keeps it for `MEASUREMENTS_KEPT_DAYS`. Written in both
 * modes; a write that fails is told, and the sample goes on.
 */
export interface MachineMeasurements {
  recordSample(row: SampleMeasured): void
  /** Only the lanes that changed since each was last kept. */
  recordLaneSamples(rows: readonly LaneMeasured[]): void
  recordDecisions(rows: readonly DecisionMeasured[]): void
  recordEvents(rows: readonly EventMeasured[]): void
  /** Rows older than `MEASUREMENTS_KEPT_DAYS`, by the store's clock, deleted. */
  trim(): void
}

/**
 * The lane VM's repair, as the host does it, for a host that may repair:
 * made only where the disk can be repaired and the host manages the
 * machine, so with none no path reaches a VM's stop. `Held` and
 * `LauncherHeld` are the host's proofs that it holds the repair lock and
 * the launcher's: each step that needs one takes it.
 */
export interface RepairControls<Held, LauncherHeld> {
  /** The repair lock now, or `held-by-another` (a repair, or a VM's start). */
  takeRepairLock(): Promise<
    | Held
    | "held-by-another"
    | { readonly kind: "failed"; readonly detail: string }
  >
  /** Settles if the lock is lost: the repair stops, and is failed. */
  lockLost(held: Held): Promise<void>
  /** The shared state, as any host reads it. */
  readRepair(): Promise<RepairRead>
  /** Why the repair boot cannot run now, without fetching or building; null when it can. */
  repairBootMissing(): Promise<string | null>
  /** The data disk's size now, in bytes. */
  diskSize(): Promise<number>
  /** Stops the VM, whatever leases it holds: every host's lease ends. */
  stopVmForRepair(held: Held): Promise<void>
  /** Waits for the launcher to exit, then holds its lock: no launcher runs while it is held. */
  awaitLauncherGone(held: Held): Promise<LauncherHeld>
  /** Grows the data disk as a start would; returns its size after. */
  growForRepair(held: Held): Promise<number>
  /** Boots the repair on the data disk, each `[repair] ` line told as it comes. */
  bootRepair(
    held: Held,
    launcherHeld: LauncherHeld,
    onLine: (line: string) => void,
  ): Promise<RepairOutcome>
  writeRepairState(held: Held, state: RepairState): Promise<void>
  /** Lets both locks go: the kept leases then start the VM again. */
  releaseRepairLocks(
    held: Held,
    launcherHeld: LauncherHeld | null,
  ): Promise<void>
}

/** Where the health value goes: the session's `pinetrie.machine`. */
export interface HealthSink {
  write(health: MachineHealth): Promise<void>
}

export interface MachineManager {
  /** Writes `unsampled` at once, and queues the first sample without waiting for it. */
  start(): Promise<void>
  /** Queues a sample, merged with one already queued; never two at once. */
  sample(): Promise<void>
  /**
   * The last sample with what was planned from it, as its step ended: what
   * the Machine page shows. Null before a sample has read; a failed sample
   * keeps the last that read, with the health planned since.
   */
  latestReading(): MachineReading | null
  /**
   * A person asked for the lane VM's failed repair to run again: the next
   * sample's repair step asks the reducer, which takes it only from
   * `failed`, so from any other state it changes nothing. A sample is
   * queued for it.
   */
  askRepairAgain(): void
  /** A turn's snapshot was skipped, its index row unwritten: counted in the next sample. */
  noteSnapshotSkipped(): void
  /**
   * A disk upkeep queued, merged with one already queued; none while
   * observing. Every trigger asks alike (a start, a run's end, a timer): the
   * step decides from what it finds.
   */
  requestUpkeep(): void
  /** An archive's snapshots marked to delete, a step on the manager's keeper; then an upkeep. */
  markArchivedForDeletion(snapshots: readonly SnapshotId[]): Promise<void>
  /** A restore's lanes' rows marked to delete kept again, a step on the manager's keeper; then an upkeep. */
  keepRestored(lanes: readonly ThreadId[]): Promise<void>
  /**
   * Settles once `lane`'s treatment allows `activity`: at once, or after a
   * later sample's plan. Rejects with `signal`'s reason when it aborts, and
   * with `KeeperClosed` at `close`. Observing, it settles at once. A
   * `container-start` waiting is what the next plan counts among the lanes
   * waiting to start.
   */
  waitUntilAllowed(
    lane: ThreadId,
    activity: LaneActivity,
    signal?: AbortSignal,
  ): Promise<void>
  /** Settles once no sample or upkeep step is queued or running, those they queue included. */
  idle(): Promise<void>
  /** Waits for a sample that runs, then writes `unsampled`: a stopped host's value never outlives it. */
  close(): Promise<void>
}
