// core/machine — the health of the machine lanes run on, as a value: what
// `@pinetrie/machine` plans, `@pinetrie/rules` stores as `pinetrie.machine`,
// and `@pinetrie/interface` words.

import type { ThreadId } from "./ids.ts"

export const MACHINE_STATES = ["neutral", "amber", "red"] as const

/** Neutral: lanes and the host keep up; amber: work waits or slows; red: work cannot go. */
export type MachineState = (typeof MACHINE_STATES)[number]

/**
 * Why the machine is not neutral, one value per reason. Sizes are bytes. A
 * cause added here fails the type check where causes are worded until it is.
 */
export type MachineCause =
  /** The store's unallocated space is under the minimum it keeps. */
  | {
      readonly kind: "room-low"
      readonly unallocated: number
      readonly minimum: number
      /** The disk grows when the lane VM next starts: its settings and the volume allow it. */
      readonly grows: boolean
    }
  /** The store has almost no unallocated space: a write may fail. */
  | { readonly kind: "room-spent"; readonly unallocated: number }
  /** btrfs's metadata is nearly full, and no room is left to grow it. */
  | {
      readonly kind: "metadata-full"
      readonly used: number
      readonly total: number
    }
  /** The filesystem holding the store has less free than it should leave. */
  | {
      readonly kind: "filesystem-low"
      readonly free: number
      readonly leaveFree: number
    }
  /**
   * Memory is short: the memory rung, 2 or more, at which runs' starts are
   * held (2) and lanes beyond the most important are paused (3). Observing,
   * a host holds nothing (`isHolding` false), and says only that it is short.
   */
  | {
      readonly kind: "memory-short"
      readonly rung: number
      readonly isHolding: boolean
    }
  | { readonly kind: "lane-oom-killed"; readonly lane: ThreadId }
  /** A process in a service's container was killed at its memory limit. */
  | { readonly kind: "service-oom-killed"; readonly service: MachineService }
  /** The host's event loop stalled, the longest in ms. */
  | { readonly kind: "host-stalls"; readonly stalledMs: number }
  /** Turns whose snapshot was skipped since the last sample: its index row could not be written. */
  | { readonly kind: "snapshot-skipped"; readonly count: number }
  /** The disk upkeep is deleting old turns' snapshots, the store's room under its floor. */
  | { readonly kind: "freeing-room" }
  /** The store's room is under its floor, and nothing is left that may be deleted. */
  | {
      readonly kind: "room-unrecoverable"
      readonly unallocated: number
      readonly minimum: number
      /** Whether pine·trie repairs the disk here (the lane VM's), or the person must (Linux's). */
      readonly isRepaired: boolean
    }
  /** The lane VM's data disk is full and being repaired, offline: every lane waits. */
  | {
      readonly kind: "disk-being-repaired"
      readonly step: "detected" | "stopping-vm" | "booting-repair"
      /** The repair boot's last line, while it runs. */
      readonly progress: string | null
    }
  /** A repair of the lane VM's data disk failed; none is tried again until the disk could grow. */
  | { readonly kind: "disk-repair-failed"; readonly why: string }
  /**
   * No sample says how the machine is: none yet since the host started,
   * the host stopped, the last sample failed, with its error, or no sample
   * has ended for a while, so nothing is held on a reading gone stale.
   */
  | {
      readonly kind: "unsampled"
      readonly reason: UnsampledReason
      readonly error: string | null
    }

export const MACHINE_SERVICES = ["disks", "privileged", "observer"] as const

/** A process pine·trie runs beside the lanes: a lanehost role, or the observer. */
export type MachineService = (typeof MACHINE_SERVICES)[number]

export const UNSAMPLED_REASONS = [
  "waiting",
  "stopped",
  "failed",
  "overdue",
] as const

type UnsampledReason = (typeof UNSAMPLED_REASONS)[number]

export type MachineCauseKind = MachineCause["kind"]

export interface MachineHealth {
  /** The worst cause's; neutral with none. */
  readonly state: MachineState
  /** Worst first. */
  readonly causes: readonly MachineCause[]
  /** Each lane held, by id: those not listed are `normal`. */
  readonly treatments: readonly HeldLane[]
}

export const LANE_TREATMENTS = [
  "normal",
  "waiting-to-start",
  "paused",
  "waiting-for-repair",
] as const

/**
 * What the machine lets a lane do for now: `waiting-to-start`, its run's
 * container waits for room; `paused`, its next tool call waits;
 * `waiting-for-repair`, neither, while the lane VM's disk is repaired. A
 * treatment added here fails the type check where what each allows is said.
 */
export type LaneTreatment = { readonly kind: (typeof LANE_TREATMENTS)[number] }

/** A lane held, and how. */
export interface HeldLane {
  readonly lane: ThreadId
  readonly treatment: LaneTreatment
}

/** Pressure stall information's `avg10`s: percentages of the last 10 s. */
export interface Pressure {
  /** Some task stalled on the resource. */
  readonly someAvg10: number
  /** Every task stalled on it at once. */
  readonly fullAvg10: number
}

/**
 * The kernel's memory counters since it started, for the measurements'
 * differences: pages read back after reclaim dropped them, by kind, and
 * the time tasks stalled on memory, in µs. Read from the machine's
 * `/proc/vmstat` and `/proc/pressure/memory`, or a cgroup's own.
 */
export interface MemoryCounters {
  readonly refaultAnon: number
  readonly refaultFile: number
  readonly stallSomeUs: number
  readonly stallFullUs: number
}

/**
 * The machine's own reclaim, counted since it started, in `/proc/vmstat`:
 * tasks stalled to reclaim (`allocstall_*`, every zone's together) and
 * pages scanned by them and by kswapd. A cgroup reclaiming at its own
 * limit counts in none of them, so they rise only when the machine is
 * short.
 */
export interface MachineReclaim {
  readonly allocStalls: number
  readonly scannedDirect: number
  readonly scannedByKswapd: number
}

/**
 * A cgroup's `memory.events` counts since it was made: the times its use
 * met `memory.max` and went over `memory.high`.
 */
export interface CgroupLimitHits {
  readonly max: number
  readonly high: number
}

/**
 * What a host reads as the machine's memory: the whole machine's, or, for a
 * host inside a lane, its own cgroup's, which its inner lanes share; the
 * lane VM's whole is other threads' too.
 */
export type MemorySource = "whole-machine" | "own-cgroup"

/** One cgroup's memory, in bytes, as its own files say it. */
export interface CgroupMemory {
  readonly current: number
  /** Memory its processes hold of their own. */
  readonly anon: number
  /** Its page cache, which the kernel can drop. */
  readonly file: number
  /** Its ceiling; null for none (`max`). */
  readonly limit: number | null
  /** Its processes the kernel killed for memory, since the cgroup was made. */
  readonly oomKills: number
  readonly limitHits: CgroupLimitHits
  /** null where the kernel has no PSI. */
  readonly pressure: Pressure | null
}

/** A btrfs filesystem's space, in bytes, from its own counters: never `df`, which counts what chunks hold, not what is left to allocate. */
export interface StoreRoom {
  /** Its devices' size together. */
  readonly size: number
  /** What no chunk holds yet: what data and metadata can still grow into. */
  readonly unallocated: number
  readonly data: { readonly total: number; readonly used: number }
  readonly metadata: { readonly total: number; readonly used: number }
}
