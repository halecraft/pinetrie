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
  /** The machine's tasks all stalled on memory, `full avg10`, a percentage. */
  | { readonly kind: "memory-stalls"; readonly fullAvg10: number }
  | { readonly kind: "lane-oom-killed"; readonly lane: ThreadId }
  /** A process in a service's container was killed at its memory limit. */
  | { readonly kind: "service-oom-killed"; readonly service: MachineService }
  /** The host's event loop stalled, the longest in ms. */
  | { readonly kind: "host-stalls"; readonly stalledMs: number }
  /**
   * No sample says how the machine is: none yet since the host started,
   * the host stopped, or the last sample failed, with its error.
   */
  | {
      readonly kind: "unsampled"
      readonly reason: UnsampledReason
      readonly error: string | null
    }

export const MACHINE_SERVICES = ["disks", "privileged", "observer"] as const

/** A process pine·trie runs beside the lanes: a lanehost role, or the observer. */
export type MachineService = (typeof MACHINE_SERVICES)[number]

export const UNSAMPLED_REASONS = ["waiting", "stopped", "failed"] as const

type UnsampledReason = (typeof UNSAMPLED_REASONS)[number]

export type MachineCauseKind = MachineCause["kind"]

export interface MachineHealth {
  /** The worst cause's; neutral with none. */
  readonly state: MachineState
  /** Worst first. */
  readonly causes: readonly MachineCause[]
}

/** Pressure stall information's `avg10`s: percentages of the last 10 s. */
export interface Pressure {
  /** Some task stalled on the resource. */
  readonly someAvg10: number
  /** Every task stalled on it at once. */
  readonly fullAvg10: number
}

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
