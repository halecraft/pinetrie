// core/machine-page — what the host serves the Machine page: the machine's
// last reading, what happened lately, and what this host can do about it,
// as values. `@pinetrie/machine` and the host build them; `@pinetrie/interface`
// words them. Sizes are bytes, a field named with its unit where it is not.

import type { ThreadId } from "./ids.ts"
import type {
  CgroupLimitHits,
  LaneTreatment,
  MachineHealth,
  MachineService,
  MemorySource,
  Pressure,
} from "./machine.ts"
import type { ThreadName } from "./thread-names.ts"

/**
 * How often the host samples the machine, and so how often the Machine page
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

/** A cgroup the host reads: a lane's, a service's, or a host in a lane's own. */
export type LimitSubject =
  | { readonly kind: "lane"; readonly lane: ThreadId }
  | { readonly kind: "service"; readonly service: MachineService }
  | { readonly kind: "own" }

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
export interface MachinePageLane {
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

/** What the last sample read, and what was planned from it. */
export interface MachinePageSampled {
  readonly kind: "sampled"
  readonly memory: {
    readonly totalBytes: number
    readonly availableBytes: number
    readonly source: MemorySource
    readonly pressure: Measured<Pressure>
    /** Memory's rung, 0 to 3: 2 holds runs' starts, 3 pauses lanes. */
    readonly rung: number
  }
  /** The store's btrfs room, against the minimum it keeps and its largest setting. */
  readonly store: Measured<{
    readonly sizeBytes: number
    readonly unallocatedBytes: number
    readonly minimumBytes: number
    readonly maxBytes: number | null
  }>
  /** The disk holding the store, against what pine·trie leaves free of it. */
  readonly filesystem: Measured<{
    readonly sizeBytes: number
    readonly freeBytes: number
    readonly leaveFreeBytes: number
  }>
  readonly lanes: readonly MachinePageLane[]
  readonly services: readonly ServiceReading[]
}

/** What this host can do from the page; each carried only where it can. */
export type MachineAction =
  | { readonly kind: "archive" }
  /** The lane VM's failed repair run again, and why it failed. */
  | { readonly kind: "repair-again"; readonly why: string }

export interface MachinePageFacts {
  /** The health value as last planned: the page's Now. */
  readonly health: MachineHealth
  readonly reading: { readonly kind: "unsampled" } | MachinePageSampled
  /** The lane VM's memory ceiling on the Mac; null where lanes run on no VM. */
  readonly vmMemoryCeilingBytes: number | null
  /** Newest first. */
  readonly lately: readonly MachineLately[]
  /** Each named thread a lane of Lately names: a lane is never worded by its id. */
  readonly names: readonly {
    readonly lane: ThreadId
    readonly name: ThreadName
  }[]
  readonly actions: readonly MachineAction[]
}
