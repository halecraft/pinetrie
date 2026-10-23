// machine/ports — what the manager needs done, said as what is meant, never
// as a file's name. The host composes each from the adapters' raw calls.

import type { MachineHealth } from "@pinetrie/core"
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
  /** Waits for a sample that runs, then writes `unsampled`: a stopped host's value never outlives it. */
  close(): Promise<void>
}
