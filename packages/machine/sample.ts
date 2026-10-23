// machine/sample — what one sample of the machine measured, and what was
// heard since the last, as a value. What a backend cannot read is null or
// empty.

import type {
  CgroupMemory,
  MachineService,
  Pressure,
  StoreRoom,
  ThreadId,
} from "@pinetrie/core"

/** One lane's cgroup. */
export interface LaneSample extends CgroupMemory {
  readonly lane: ThreadId
}

export interface MachineSample {
  readonly machine: {
    readonly memoryTotal: number
    readonly memoryAvailable: number
    /** null where the kernel has no PSI. */
    readonly pressure: Pressure | null
  }
  /** Empty where lanes' cgroups cannot be read. */
  readonly lanes: readonly LaneSample[]
  readonly store: StoreRoom | null
  /** The filesystem holding the store, in bytes. */
  readonly filesystem: { readonly size: number; readonly free: number } | null
  /**
   * Each service killed for memory since the last sample, once per kill.
   * Heard, not counted: the observer's container goes with its kill.
   */
  readonly serviceKills: readonly MachineService[]
  /** The longest stall of the host's event loop since the last sample, in ms. */
  readonly hostStalledMs: number
  /** Turns whose snapshot was skipped since the last sample. The manager counts these, not the sensor. */
  readonly snapshotsSkipped: number
}

/** What the sensor reads: a sample less what the manager hears itself. */
export type SensedSample = Omit<MachineSample, "snapshotsSkipped">
