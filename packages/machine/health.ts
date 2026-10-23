// machine/health — the health value planned from samples. Every threshold
// counts samples, never time: the lane VM runs after the Mac's own work, so
// a sample may come late, and a count stays what it means.

import type {
  MachineCause,
  MachineCauseKind,
  MachineHealth,
  MachineState,
  StoreRoom,
  ThreadId,
} from "@pinetrie/core"
import type { MachineSample } from "./sample.ts"
import {
  leaveFreeBytes,
  minimumUnallocated,
  type StoreSettings,
} from "./store-settings.ts"

const GiB = 1024 ** 3

/** Samples in a row over a level's threshold before it is a cause. */
export const ENTER_AFTER = 3
/** Samples in a row under a cause's lower threshold, or without its event, before it leaves. */
export const LEAVE_AFTER = 6

/** Unallocated space below which the store is spent: a write may fail. */
const ROOM_SPENT = GiB
/** Unallocated space the store must regain before it is no longer spent. */
const ROOM_SPENT_CLEAR = 2 * GiB
/** A low store, or filesystem, is clear again only this far above its threshold. */
const CLEAR_MARGIN = 1.1
/** Metadata's share used, with no room to grow it, at which it is full. */
const METADATA_FULL = 0.95
const METADATA_CLEAR = 0.9
/** `full avg10` over which memory stalls are a cause: lanes overcommitted past the VM's memory reached 10. */
const MEMORY_STALLS = 10
const MEMORY_STALLS_CLEAR = 2
/** The host's event loop stalled longer than this, in ms. */
const HOST_STALL_MS = 1000

/** Each cause kind's state, red the worse. */
const SEVERITY: Readonly<Record<MachineCauseKind, MachineState>> = {
  "room-spent": "red",
  "metadata-full": "red",
  "room-unrecoverable": "red",
  "room-low": "amber",
  "filesystem-low": "amber",
  "memory-stalls": "amber",
  "lane-oom-killed": "amber",
  "service-oom-killed": "amber",
  "host-stalls": "amber",
  "snapshot-skipped": "amber",
  "freeing-room": "amber",
  unsampled: "amber",
}

/** Causes of one state, in the order they are listed: what stops work first. */
const ORDER: readonly MachineCauseKind[] = [
  "room-spent",
  "room-unrecoverable",
  "metadata-full",
  "unsampled",
  "room-low",
  "freeing-room",
  "filesystem-low",
  "memory-stalls",
  "lane-oom-killed",
  "service-oom-killed",
  "host-stalls",
  "snapshot-skipped",
]

/** The causes that are events: seen on a sample, not measured against a threshold. */
const EVENT_KINDS: ReadonlySet<MachineCauseKind> = new Set([
  "lane-oom-killed",
  "service-oom-killed",
  "host-stalls",
  "snapshot-skipped",
])

/**
 * One cause's count. Inactive, `count` is samples in a row over its
 * threshold; active, samples in a row clear of its lower one (or, for an
 * event, without it).
 */
interface Tracked {
  readonly active: boolean
  readonly count: number
  /** As last measured. */
  readonly cause: MachineCause
}

export interface HealthMemory {
  /** By `causeKey`. */
  readonly causes: ReadonlyMap<string, Tracked>
  /** Each lane's OOM kills at the last sample that read it. */
  readonly oomKills: ReadonlyMap<ThreadId, number>
  /** The health value last reported changed: what the next is compared with. */
  readonly health: MachineHealth
}

/** Before any sample: waiting for the first. */
export const WAITING: MachineHealth = {
  state: "amber",
  causes: [{ kind: "unsampled", reason: "waiting", error: null }],
}

export const STOPPED: MachineHealth = {
  state: "amber",
  causes: [{ kind: "unsampled", reason: "stopped", error: null }],
}

export const FIRST_MEMORY: HealthMemory = {
  causes: new Map(),
  oomKills: new Map(),
  health: WAITING,
}

/** What a sample says of one level cause: over its threshold, clear of its lower one, or between. */
type LevelReading =
  | { readonly kind: "over"; readonly cause: MachineCause }
  | { readonly kind: "between"; readonly cause: MachineCause }
  | { readonly kind: "clear" }
  /** Not measured this sample: counts stay as they are. */
  | { readonly kind: "unmeasured" }

/** A cause's identity: its kind, and the lane or service it names. */
const causeKey = (cause: MachineCause): string => {
  switch (cause.kind) {
    case "lane-oom-killed":
      return `${cause.kind}:${cause.lane}`
    case "service-oom-killed":
      return `${cause.kind}:${cause.service}`
    default:
      return cause.kind
  }
}

const UNMEASURED: LevelReading = { kind: "unmeasured" }

function roomReadings(
  store: StoreRoom | null,
): readonly [string, LevelReading][] {
  if (store === null)
    return [
      ["room-spent", UNMEASURED],
      ["room-low", UNMEASURED],
      ["metadata-full", UNMEASURED],
    ]
  const { unallocated } = store
  const minimum = minimumUnallocated(store.size)
  const spent: LevelReading =
    unallocated < ROOM_SPENT
      ? { kind: "over", cause: { kind: "room-spent", unallocated } }
      : unallocated < ROOM_SPENT_CLEAR
        ? { kind: "between", cause: { kind: "room-spent", unallocated } }
        : { kind: "clear" }
  const low: LevelReading =
    unallocated < minimum
      ? { kind: "over", cause: { kind: "room-low", unallocated, minimum } }
      : unallocated < minimum * CLEAR_MARGIN
        ? { kind: "between", cause: { kind: "room-low", unallocated, minimum } }
        : { kind: "clear" }
  const { used, total } = store.metadata
  const metadata = { kind: "metadata-full", used, total } as const
  const full: LevelReading =
    total > 0 && used > total * METADATA_FULL && unallocated < ROOM_SPENT
      ? { kind: "over", cause: metadata }
      : total > 0 &&
          used > total * METADATA_CLEAR &&
          unallocated < ROOM_SPENT_CLEAR
        ? { kind: "between", cause: metadata }
        : { kind: "clear" }
  return [
    ["room-spent", spent],
    ["room-low", low],
    ["metadata-full", full],
  ]
}

function filesystemReading(
  sample: MachineSample,
  settings: Pick<StoreSettings, "leaveFree">,
): LevelReading {
  if (sample.filesystem === null) return UNMEASURED
  const { free, size } = sample.filesystem
  const leaveFree = leaveFreeBytes(settings, size)
  const cause = { kind: "filesystem-low", free, leaveFree } as const
  return free < leaveFree
    ? { kind: "over", cause }
    : free < leaveFree * CLEAR_MARGIN
      ? { kind: "between", cause }
      : { kind: "clear" }
}

/**
 * What the upkeep's last step found, as levels: over while it says so,
 * clear once it does not. Unrecoverable names the room the sample read.
 */
function upkeepReadings(
  sample: MachineSample,
): readonly [string, LevelReading][] {
  const { store } = sample
  const unrecoverable: LevelReading =
    store === null
      ? UNMEASURED
      : sample.upkeep.exhausted
        ? {
            kind: "over",
            cause: {
              kind: "room-unrecoverable",
              unallocated: store.unallocated,
              minimum: minimumUnallocated(store.size),
            },
          }
        : { kind: "clear" }
  return [
    [
      "freeing-room",
      sample.upkeep.freeing
        ? { kind: "over", cause: { kind: "freeing-room" } }
        : { kind: "clear" },
    ],
    ["room-unrecoverable", unrecoverable],
  ]
}

function memoryReading(sample: MachineSample): LevelReading {
  const { pressure } = sample.machine
  if (pressure === null) return UNMEASURED
  const cause = {
    kind: "memory-stalls",
    fullAvg10: pressure.fullAvg10,
  } as const
  return pressure.fullAvg10 > MEMORY_STALLS
    ? { kind: "over", cause }
    : pressure.fullAvg10 >= MEMORY_STALLS_CLEAR
      ? { kind: "between", cause }
      : { kind: "clear" }
}

/** A level cause's next state from what this sample read. */
function nextLevelState(
  was: Tracked | undefined,
  reading: LevelReading,
): Tracked | null {
  if (reading.kind === "unmeasured") return was ?? null
  if (was === undefined || !was.active) {
    if (reading.kind !== "over") return null
    const count = (was?.count ?? 0) + 1
    return count >= ENTER_AFTER
      ? { active: true, count: 0, cause: reading.cause }
      : { active: false, count, cause: reading.cause }
  }
  if (reading.kind !== "clear")
    return { active: true, count: 0, cause: reading.cause }
  const count = was.count + 1
  return count >= LEAVE_AFTER ? null : { ...was, count }
}

/** An event cause's next state: active the sample it is seen, gone after `LEAVE_AFTER` without it. */
function nextEventState(
  was: Tracked | undefined,
  seen: MachineCause | null,
): Tracked | null {
  if (seen !== null) return { active: true, count: 0, cause: seen }
  if (was === undefined) return null
  const count = was.count + 1
  return count >= LEAVE_AFTER ? null : { ...was, count }
}

/** The health value of `causes`: sorted worst first, and the worst one's state. */
function rankedHealth(causes: readonly MachineCause[]): MachineHealth {
  // A spent store is low too; saying both says one thing twice.
  const spent = causes.some(c => c.kind === "room-spent")
  const sorted = causes
    .filter(c => !(spent && c.kind === "room-low"))
    .sort(
      (a, b) =>
        ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
        causeKey(a).localeCompare(causeKey(b)),
    )
  const first = sorted[0]
  return {
    state: first === undefined ? "neutral" : SEVERITY[first.kind],
    causes: sorted,
  }
}

/** Whether two health values say the same: one state, and the same causes by kind and lane. Their measures may differ. */
const isSameHealth = (a: MachineHealth, b: MachineHealth): boolean =>
  a.state === b.state &&
  a.causes.length === b.causes.length &&
  a.causes.every((c, i) => {
    const d = b.causes[i]
    return (
      d !== undefined &&
      causeKey(c) === causeKey(d) &&
      (c.kind !== "unsampled" ||
        (d.kind === "unsampled" && c.reason === d.reason))
    )
  })

/** What a sample, or its failure, gave. */
export type SampleResult =
  | { readonly kind: "sampled"; readonly sample: MachineSample }
  | { readonly kind: "failed"; readonly error: string }

export interface Planned {
  readonly health: MachineHealth
  readonly memory: HealthMemory
  /**
   * `health` says something the last did not: its state, or a cause
   * entered or left. A cause's measures changing alone is no change, so
   * the record is not rewritten each sample.
   */
  readonly changed: boolean
}

/**
 * The health value after one sample, from what the samples before it left
 * in `memory`. A failed sample changes no count: its causes stay as they
 * were, with `unsampled` beside them until a sample reads.
 */
export function planHealth(
  memory: HealthMemory,
  result: SampleResult,
  settings: Pick<StoreSettings, "leaveFree">,
): Planned {
  if (result.kind === "failed") {
    const health = rankedHealth([
      ...activeCauses(memory.causes),
      { kind: "unsampled", reason: "failed", error: result.error },
    ])
    return plannedHealth(memory, memory, health)
  }
  const { sample } = result
  const next = new Map<string, Tracked>()
  const levels: readonly [string, LevelReading][] = [
    ...roomReadings(sample.store),
    ["filesystem-low", filesystemReading(sample, settings)],
    ["memory-stalls", memoryReading(sample)],
    ...upkeepReadings(sample),
  ]
  for (const [key, r] of levels) {
    const stepped = nextLevelState(memory.causes.get(key), r)
    if (stepped !== null) next.set(key, stepped)
  }

  const { lanes } = sample
  const oomKills = new Map(lanes.map(l => [l.lane, l.oomKills]))
  const events: MachineCause[] = [
    ...lanes
      .filter(lane => {
        const before = memory.oomKills.get(lane.lane)
        return before !== undefined && lane.oomKills > before
      })
      .map(lane => ({ kind: "lane-oom-killed", lane: lane.lane }) as const),
    ...sample.serviceKills.map(
      service => ({ kind: "service-oom-killed", service }) as const,
    ),
  ]
  if (sample.hostStalledMs > HOST_STALL_MS)
    events.push({ kind: "host-stalls", stalledMs: sample.hostStalledMs })
  if (sample.snapshotsSkipped > 0)
    events.push({ kind: "snapshot-skipped", count: sample.snapshotsSkipped })
  const seen = new Map(events.map(c => [causeKey(c), c]))
  const eventKeys = new Set([
    ...seen.keys(),
    ...[...memory.causes]
      .filter(([, t]) => EVENT_KINDS.has(t.cause.kind))
      .map(([key]) => key),
  ])
  for (const key of eventKeys) {
    const stepped = nextEventState(
      memory.causes.get(key),
      seen.get(key) ?? null,
    )
    if (stepped !== null) next.set(key, stepped)
  }

  const health = rankedHealth(activeCauses(next))
  return plannedHealth(memory, { causes: next, oomKills, health }, health)
}

const activeCauses = (
  causes: ReadonlyMap<string, Tracked>,
): readonly MachineCause[] =>
  [...causes.values()].filter(t => t.active).map(t => t.cause)

function plannedHealth(
  before: HealthMemory,
  after: HealthMemory,
  health: MachineHealth,
): Planned {
  const changed = !isSameHealth(before.health, health)
  return {
    health,
    memory: { ...after, health: changed ? health : before.health },
    changed,
  }
}
