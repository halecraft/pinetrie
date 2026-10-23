// machine/ports — what the manager needs done, said as what is meant, never
// as a file's name. The host composes each from the adapters' raw calls.

import type { MachineHealth, SnapshotId, ThreadId } from "@pinetrie/core"
import type { SensedSample } from "./sample.ts"

export interface MachineSensor {
  sample(): Promise<SensedSample>
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
  /** Settles once no sample or upkeep step is queued or running, those they queue included. */
  idle(): Promise<void>
  /** Waits for a sample that runs, then writes `unsampled`: a stopped host's value never outlives it. */
  close(): Promise<void>
}
