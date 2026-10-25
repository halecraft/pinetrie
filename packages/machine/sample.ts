// machine/sample — what one sample of the machine measured, and what was
// heard since the last, as a value. What a backend cannot read is null or
// empty.

import type {
  CgroupLimitHits,
  CgroupMemory,
  Containment,
  HeldLane,
  MachineHealth,
  MachineReclaim,
  MachineService,
  MemoryCounters,
  MemorySource,
  Pressure,
  ServiceReading,
  StoreRoom,
  ThreadId,
} from "@pinetrie/core"
import type { PressureScope } from "./pressure-scope.ts"
import type { RepairFacts } from "./repair.ts"
import type { Rung } from "./rung.ts"

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
    /** The kernel's refaults and stall time since it started; null where they could not be read. */
    readonly counters: MemoryCounters | null
    /**
     * The machine's own reclaim since it started; null on an own-cgroup
     * read, whose machine's counters are other threads' too, or where
     * they could not be read.
     */
    readonly reclaim: MachineReclaim | null
    /** A host in a lane's own cgroup's limit hits; null on a whole-machine read, or where they could not be read. */
    readonly limitHits: CgroupLimitHits | null
    /** Whose memory these are: the whole machine's, or a host in a lane's own cgroup's. */
    readonly source: MemorySource
  }
  /** Empty where lanes' cgroups cannot be read. */
  readonly lanes: readonly LaneSample[]
  /**
   * Every running lane container, its cgroup read or not: what treatments
   * are planned over, since a backend without lanes' cgroups gives `lanes`
   * empty while its lanes run.
   */
  readonly lanesRunning: readonly ThreadId[]
  readonly store: StoreRoom | null
  /** The filesystem holding the store, in bytes. */
  readonly filesystem: { readonly size: number; readonly free: number } | null
  /**
   * Each lanehost role's and the observer's memory, or why it was not read:
   * a host in a lane reads no observer, which is the host outside's.
   */
  readonly services: readonly ServiceReading[]
  /**
   * What took effect of each running container's controls and the
   * services' floor, read from this sample's cgroups (`planContainment`).
   */
  readonly containment: Containment
  /**
   * Each service killed for memory since the last sample, once per kill.
   * Heard, not counted: the observer's container goes with its kill.
   */
  readonly serviceKills: readonly MachineService[]
  /** The longest stall of the host's event loop since the last sample, in ms. */
  readonly hostStalledMs: number
  /** Turns whose snapshot was skipped since the last sample. The manager counts these, not the sensor. */
  readonly snapshotsSkipped: number
  /** What the last upkeep step found: the manager's, not the sensor's. */
  readonly upkeep: UpkeepHeard
}

/** The last sample that read, and what the step that took it, or a later one, planned. */
export interface ReadingPlanned {
  readonly sample: MachineSample
  /** What its pressure says, as its rung read it. */
  readonly scope: PressureScope
  readonly health: MachineHealth
  readonly rung: Rung
  /** The lanes held as last applied: memory's, or every lane while a repair runs. */
  readonly held: readonly HeldLane[]
  readonly repair: RepairFacts
}

/**
 * What the Health page shows: fresh, as the last sample planned it; or
 * overdue, no sample having ended for the bound, its health saying so and
 * holding nothing, with the last reading kept (null before any read).
 */
export type MachineReading =
  | ({ readonly kind: "fresh" } & ReadingPlanned)
  | {
      readonly kind: "overdue"
      readonly health: MachineHealth
      readonly last: ReadingPlanned | null
    }

/** What the disk upkeep's last step found, with the store's room under its floor. */
export interface UpkeepHeard {
  /** It deleted snapshots to free room. */
  readonly freeing: boolean
  /** It found nothing left that may be deleted. */
  readonly exhausted: boolean
}

/** What the sensor reads: a sample less what the manager hears itself. */
export type SensedSample = Omit<MachineSample, "snapshotsSkipped" | "upkeep">
