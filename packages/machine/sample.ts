// machine/sample — what one sample of the machine measured, as a value. It
// holds only what was measured: what a backend cannot read is null or
// empty.

import type {
  CgroupMemory,
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
  /** The longest stall of the host's event loop since the last sample, in ms. */
  readonly hostStalledMs: number
}
