// core/machine-facts — what the host serves at `GET /machine`: the
// machine's last reading against the bounds pine·trie acts at, its last
// hour, what happened lately, and what this host can do about it, as
// values; and `boundReading`, the one judge of a reading against a bound,
// which the health's planners and the Health page both call.
// `@pinetrie/machine` and the host build the facts; `@pinetrie/interface`
// words them. Sizes are bytes, a field named with its unit where it is not.

import type { ThreadId } from "./ids.ts"
import type {
  CgroupLimitHits,
  Containment,
  LaneTreatment,
  LimitSubject,
  MachineHealth,
  MachineService,
  Pressure,
} from "./machine.ts"
import type { ThreadName } from "./thread-names.ts"

/**
 * How often the host samples the machine, and so how often the Health page
 * asks for its facts: the thresholds count samples, so the page never asks
 * for one of its own.
 */
export const MACHINE_SAMPLE_MS = 5_000

/** A reading pine·trie could take, or why it could not: never a 0 that stands for none. */
export type Measured<T> =
  | ({ readonly kind: "read" } & T)
  | { readonly kind: "unreadable"; readonly why: string }

/** The programs whose slow commands the host times. */
export const TIMED_PROGRAMS = ["jj", "git"] as const

/**
 * Something the host saw happen that no decision row holds: each kept in
 * the measurements' `events` table, and shown in Lately.
 */
export type EventMeasured =
  | { readonly kind: "lane-oom-killed"; readonly lane: ThreadId }
  | { readonly kind: "service-oom-killed"; readonly service: MachineService }
  /**
   * A cgroup met its memory limit since the last sample: the rise of its
   * `memory.events` `max` and `high`. Kept only when one rose.
   */
  | {
      readonly kind: "cgroup-at-limit"
      readonly subject: LimitSubject
      readonly maxHits: number
      readonly highHits: number
    }
  /** The disk upkeep deleted snapshots, `bytes` their metadata's estimated cost. */
  | {
      readonly kind: "snapshots-deleted"
      readonly count: number
      readonly bytes: number
    }
  /** The host's event loop stalled, the longest since the last sample. */
  | { readonly kind: "host-stalled"; readonly ms: number }
  /** A person asked for the lane VM's failed repair to run again. */
  | { readonly kind: "repair-asked-again" }
  /** A keeper's step ran past its limit; `where` names whose keeper, null for the documents'. */
  | {
      readonly kind: "slow-step"
      readonly where: string | null
      readonly ms: number
    }
  /** A `jj` or `git` command ran past its limit: its first argument, never the rest. */
  | {
      readonly kind: "slow-command"
      readonly program: (typeof TIMED_PROGRAMS)[number]
      readonly subcommand: string | null
      readonly ms: number
    }

/** The lane VM's repair's states, as its decision rows name them. */
export const REPAIR_STEPS = [
  "idle",
  "detected",
  "stopping-vm",
  "booting-repair",
  "done",
  "failed",
] as const
export type RepairStep = (typeof REPAIR_STEPS)[number]

/** One thing that happened, at the host's clock (ms since the epoch). */
export type MachineLately = { readonly at: number } & (
  | { readonly kind: "event"; readonly event: EventMeasured }
  | {
      readonly kind: "treatment"
      readonly lane: ThreadId
      readonly from: LaneTreatment["kind"]
      readonly to: LaneTreatment["kind"]
    }
  | {
      readonly kind: "repair"
      readonly from: RepairStep
      readonly to: RepairStep
    }
  /** Memory's rung moved, read from consecutive samples. */
  | { readonly kind: "rung"; readonly from: number; readonly to: number }
)

/** A running lane: its thread, how it is held, its memory, and its snapshots. */
export interface MachineLane {
  readonly lane: ThreadId
  /** Null for a thread not named yet: a lane is never worded by its id. */
  readonly name: ThreadName | null
  readonly treatment: LaneTreatment["kind"]
  readonly memory: Measured<{
    readonly currentBytes: number
    readonly limitBytes: number | null
    readonly anonBytes: number
    readonly fileBytes: number
  }>
  /** Its kept snapshots, and their metadata's estimated cost. */
  readonly snapshots: { readonly count: number; readonly bytes: number }
}

/** A service pine·trie runs beside the lanes, its memory against its limit. */
export interface ServiceReading {
  readonly service: MachineService
  readonly memory: Measured<{
    readonly currentBytes: number
    readonly limitBytes: number | null
    readonly limitHits: CgroupLimitHits
  }>
}

/** Which side of a bound is worse: memory and disks run low, pressure runs high. */
export type BoundSide = "below" | "above"

/** What pine·trie does once a reading passes a bound. */
export type BoundAction =
  | "hold-starts"
  | "pause-threads"
  | "delete-snapshots"
  | "writes-may-fail"
  | "stop-growing"

/**
 * A bound in its reading's own unit. Past `acts` on its `worse` side,
 * pine·trie acts; it stops only once the reading is back past `clears`.
 */
export interface ActingBound {
  readonly worse: BoundSide
  readonly acts: number
  readonly clears: number
  readonly does: BoundAction
}

/** A reading against a bound: past `acts`, past only `clears`, or clear. */
type BoundReading = "over" | "near" | "clear"

/**
 * `value` against `bound`, strictly: a value exactly at `acts` is near,
 * and one exactly at `clears` is clear. `near` is where a level the
 * planners track stays as it was: entered, it holds; not, it waits.
 */
export function boundReading(value: number, bound: ActingBound): BoundReading {
  const isPast = (limit: number) =>
    bound.worse === "below" ? value < limit : value > limit
  return isPast(bound.acts) ? "over" : isPast(bound.clears) ? "near" : "clear"
}

/** How many minutes of history the host keeps in memory and serves. */
export const HISTORY_MINUTES = 60

/** One minute of the machine, as its samples read it. */
export interface HistoryMinute {
  /** The minute's least: a dip is never averaged away. */
  readonly memoryAvailableBytes: number
  /** The minute's most `full_avg10` among stalls that were the machine's; null where none was. */
  readonly machinePressureFull: number | null
  /** A stall in the minute stayed inside one thread's own limit. */
  readonly isContainedStall: boolean
  /** Each lane's most memory in the minute, by lane. */
  readonly laneBytes: Readonly<Record<ThreadId, number>>
}

/** `HISTORY_MINUTES` long, oldest first, ending at the latest sample's minute; null for a minute with no sample. */
export interface MachineHistory {
  readonly minutes: readonly (HistoryMinute | null)[]
}

/** What the machine lanes run on is: the lane VM on a Mac, a Linux host's own Docker, or a host's own lane's cgroup. */
export type MachineKind = "lane-vm" | "linux-host" | "own-cgroup"

/** What the last sample read, against the bounds it is judged by, and what was planned from it. */
export interface MachineSampled {
  readonly kind: "sampled"
  readonly memory: {
    readonly totalBytes: number
    readonly availableBytes: number
    /** Memory's rung, 0 to 5: 2 holds new runs' starts, 3 pauses threads; 1, 4 and 5 are measured, never acted on. */
    readonly rung: number
    /** In available bytes, the first reached first. */
    readonly bounds: readonly ActingBound[]
    /** Whose stall it is, as the rung reads it; unreadable where the kernel keeps no pressure. */
    readonly pressure: Measured<
      Pressure & {
        readonly scope: "machine" | "contained"
        /** In `full_avg10`, the first reached first. */
        readonly bounds: readonly ActingBound[]
      }
    >
  }
  /** The store's btrfs room, against what pine·trie acts at and its largest setting. */
  readonly store: Measured<{
    readonly sizeBytes: number
    readonly unallocatedBytes: number
    readonly maxBytes: number | null
    /** In unallocated bytes, the first reached first. */
    readonly bounds: readonly ActingBound[]
  }>
  /** The disk holding the store, against what pine·trie leaves free of it. */
  readonly filesystem: Measured<{
    readonly sizeBytes: number
    readonly freeBytes: number
    /** In free bytes. */
    readonly bounds: readonly ActingBound[]
  }>
  readonly lanes: readonly MachineLane[]
  readonly services: readonly ServiceReading[]
  /** What took effect of the containers' controls, read back from their cgroups this sample. */
  readonly containment: Containment
  readonly history: MachineHistory
}

/** What this host can do from the page; each carried only where it can. */
export type MachineAction =
  | { readonly kind: "archive" }
  /** The lane VM's failed repair run again, and why it failed. */
  | { readonly kind: "repair-again"; readonly why: string }

export interface MachineFacts {
  /** The health value as last planned: the page's verdict. */
  readonly health: MachineHealth
  readonly machineKind: MachineKind
  readonly reading: { readonly kind: "unsampled" } | MachineSampled
  /** The lane VM's memory ceiling on the Mac; null where lanes run on no VM. */
  readonly vmMemoryCeilingBytes: number | null
  /** The services' guaranteed floor this host asks for; null where it keeps none (a Linux host's cgroups are the person's). */
  readonly servicesFloorBytes: number | null
  /** systemd-oomd may stop this host's lanes, outside pine·trie: it manages rootless Docker's containers here. */
  readonly isOomdManagingLanes: boolean
  /** What happened in the last day, newest first. */
  readonly lately: readonly MachineLately[]
  /** The host's cap cut `lately` short of the day: it spans from its oldest. */
  readonly latelyCapped: boolean
  /** Each named thread a lane of Lately names: a lane is never worded by its id. */
  readonly names: readonly {
    readonly lane: ThreadId
    readonly name: ThreadName
  }[]
  readonly actions: readonly MachineAction[]
}
