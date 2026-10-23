// machine/ports — what the manager needs done, said as what is meant, never
// as a file's name. The host composes each from the adapters' raw calls.

import type { MachineHealth, SnapshotId, ThreadId } from "@pinetrie/core"
import type {
  DecisionMeasured,
  LaneMeasured,
  SampleMeasured,
} from "./measurements.ts"
import type { SensedSample } from "./sample.ts"
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
  /** Rows older than `MEASUREMENTS_KEPT_DAYS`, by the store's clock, deleted. */
  trim(): void
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
