// machine/health — the health value planned from samples. Every threshold
// counts samples, never time: the lane VM runs after the Mac's own work, so
// a sample may come late, and a count stays what it means.

import {
  type ActingBound,
  assertNever,
  boundReading,
  type HeldLane,
  type MachineCause,
  type MachineCauseKind,
  type MachineHealth,
  type MachineState,
  type ThreadId,
} from "@pinetrie/core"
import {
  filesystemBound,
  ROOM_SPENT,
  ROOM_SPENT_CLEAR,
  storeBounds,
} from "./bounds.ts"
import type { StoreCapabilities } from "./capabilities.ts"
import {
  type LevelReading,
  nextEventState,
  nextLevelState,
  type Tracked,
} from "./hysteresis.ts"
import type { CauseLimitEvent } from "./measurements.ts"
import type { Rung } from "./rung.ts"
import type { MachineSample } from "./sample.ts"
import { minimumUnallocated, type StoreSettings } from "./store-settings.ts"
import { plannedStoreSize } from "./store-size.ts"

/** Metadata's share used, with no room to grow it, at which it is full. */
export const METADATA_FULL = 0.95
export const METADATA_CLEAR = 0.9
/** The host's event loop stalled longer than this, in ms. */
const HOST_STALL_MS = 1000

/** Each cause kind's state, red the worse. */
const SEVERITY: Readonly<Record<MachineCauseKind, MachineState>> = {
  "room-spent": "red",
  "metadata-full": "red",
  "room-unrecoverable": "red",
  "disk-being-repaired": "red",
  "disk-repair-failed": "red",
  "room-low": "amber",
  "filesystem-low": "amber",
  "memory-short": "amber",
  "lane-oom-killed": "amber",
  "service-oom-killed": "amber",
  "cgroup-at-limit": "amber",
  "host-stalls": "amber",
  "snapshot-skipped": "amber",
  "freeing-room": "amber",
  unsampled: "amber",
}

/** Causes of one state, in the order they are listed: what stops work first. */
const ORDER: readonly MachineCauseKind[] = [
  "disk-repair-failed",
  "disk-being-repaired",
  "room-spent",
  "room-unrecoverable",
  "metadata-full",
  "unsampled",
  "room-low",
  "freeing-room",
  "filesystem-low",
  "memory-short",
  "lane-oom-killed",
  "service-oom-killed",
  "cgroup-at-limit",
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

export interface HealthPlanState {
  /** By `causeKey`. */
  readonly causes: ReadonlyMap<string, Tracked<MachineCause>>
  /** Each lane's OOM kills at the last sample that read it. */
  readonly oomKills: ReadonlyMap<ThreadId, number>
  /** The health value last reported changed: what the next is compared with. */
  readonly health: MachineHealth
}

/** Before any sample: waiting for the first. */
export const WAITING: MachineHealth = {
  state: "amber",
  causes: [{ kind: "unsampled", reason: "waiting", error: null }],
  treatments: [],
}

export const STOPPED: MachineHealth = {
  state: "amber",
  causes: [{ kind: "unsampled", reason: "stopped", error: null }],
  treatments: [],
}

export const FIRST_HEALTH_STATE: HealthPlanState = {
  causes: new Map(),
  oomKills: new Map(),
  health: WAITING,
}

/** What a sample says of one level cause. */
type CauseReading = LevelReading<MachineCause>

/** A cause's identity: its kind, and the lane or service it names. */
const causeKey = (cause: MachineCause): string => {
  switch (cause.kind) {
    case "lane-oom-killed":
      return `${cause.kind}:${cause.lane}`
    case "service-oom-killed":
      return `${cause.kind}:${cause.service}`
    case "cgroup-at-limit":
      return cause.subject.kind === "lane"
        ? `${cause.kind}:lane:${cause.subject.lane}`
        : `${cause.kind}:service:${cause.subject.service}`
    default:
      return cause.kind
  }
}

const UNMEASURED: CauseReading = { kind: "unmeasured" }

/** A level cause read against its bound: over past `acts`, between until past `clears`. */
function levelReading(
  value: number,
  bound: ActingBound,
  cause: MachineCause,
): CauseReading {
  const read = boundReading(value, bound)
  switch (read) {
    case "over":
      return { kind: "over", value: cause }
    case "near":
      return { kind: "between", value: cause }
    case "clear":
      return { kind: "clear" }
    default:
      return assertNever(read)
  }
}

function roomReadings(
  sample: MachineSample,
  settings: Pick<StoreSettings, "leaveFree" | "max">,
  capabilities: StoreCapabilities,
): readonly [string, CauseReading][] {
  const { store } = sample
  if (store === null)
    return [
      ["room-spent", UNMEASURED],
      ["room-low", UNMEASURED],
      ["metadata-full", UNMEASURED],
    ]
  const { unallocated } = store
  const bounds = storeBounds(store.size)
  // Planned from what the sample read: btrfs's chunks stand for what the
  // disk holds, and the store's filesystem for the volume holding it.
  const grows =
    (plannedStoreSize(sample, settings, capabilities) ?? store.size) >
    store.size
  const spent = levelReading(unallocated, bounds.spent, {
    kind: "room-spent",
    unallocated,
  })
  const low = levelReading(unallocated, bounds.low, {
    kind: "room-low",
    unallocated,
    minimum: minimumUnallocated(store.size),
    grows,
  })
  const { used, total } = store.metadata
  const metadata = { kind: "metadata-full", used, total } as const
  const full: CauseReading =
    total > 0 && used > total * METADATA_FULL && unallocated < ROOM_SPENT
      ? { kind: "over", value: metadata }
      : total > 0 &&
          used > total * METADATA_CLEAR &&
          unallocated < ROOM_SPENT_CLEAR
        ? { kind: "between", value: metadata }
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
): CauseReading {
  if (sample.filesystem === null) return UNMEASURED
  const { free, size } = sample.filesystem
  const bound = filesystemBound(settings, size)
  return levelReading(free, bound, {
    kind: "filesystem-low",
    free,
    leaveFree: bound.acts,
  })
}

/**
 * What the upkeep's last step found, as levels: over while it says so,
 * clear once it does not. Unrecoverable names the room the sample read.
 */
function upkeepReadings(
  sample: MachineSample,
  capabilities: StoreCapabilities,
): readonly [string, CauseReading][] {
  const { store } = sample
  const unrecoverable: CauseReading =
    store === null
      ? UNMEASURED
      : sample.upkeep.exhausted
        ? {
            kind: "over",
            value: {
              kind: "room-unrecoverable",
              unallocated: store.unallocated,
              minimum: minimumUnallocated(store.size),
              isRepaired: capabilities.repairDisk,
            },
          }
        : { kind: "clear" }
  return [
    [
      "freeing-room",
      sample.upkeep.freeing
        ? { kind: "over", value: { kind: "freeing-room" } }
        : { kind: "clear" },
    ],
    ["room-unrecoverable", unrecoverable],
  ]
}

/**
 * Each cgroup at its limit, as a level per subject: over in a sample whose
 * events name it with its `max` risen, clear in one that does not. So one
 * that meets its limit `ENTER_AFTER` samples running is a cause, and one
 * that stops for `LEAVE_AFTER` is not. A subject tracked already is read
 * too, so its count goes on when it stops meeting it.
 */
function atLimitReadings(
  causes: ReadonlyMap<string, Tracked<MachineCause>>,
  atLimit: readonly CauseLimitEvent[],
): readonly [string, CauseReading][] {
  const over = new Map(
    atLimit
      .filter(e => e.maxHits > 0)
      .map(e => {
        const cause = { kind: "cgroup-at-limit", subject: e.subject } as const
        return [causeKey(cause), cause]
      }),
  )
  const tracked = [...causes]
    .filter(([, t]) => t.value.kind === "cgroup-at-limit")
    .map(([key]) => key)
  return [...new Set([...over.keys(), ...tracked])].map(key => {
    const cause = over.get(key)
    return [
      key,
      cause === undefined ? { kind: "clear" } : { kind: "over", value: cause },
    ]
  })
}

/** The health value of `causes`: sorted worst first, and the worst one's state. */
function rankedHealth(
  causes: readonly MachineCause[],
  { memory, repair }: Beside,
): MachineHealth {
  // A spent store is low too; saying both says one thing twice.
  const spent = causes.some(c => c.kind === "room-spent")
  const sorted = [
    ...causes,
    ...(memory.rung >= 2
      ? [
          {
            kind: "memory-short",
            rung: memory.rung,
            isHolding: memory.isHolding,
          } as const,
        ]
      : []),
    ...(repair === null ? [] : [repair]),
  ]
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
    treatments: memory.held,
  }
}

/**
 * What is planned beside the samples' causes and added to the health value
 * as it is, each sample: memory's rung and the lanes held, and the
 * repair's cause (`repairCause`), read from the state every host shares.
 */
export interface Beside {
  readonly memory: MemoryShort
  readonly repair: MachineCause | null
}

/**
 * Whether two health values say the same: one state, the same causes by
 * kind and lane, memory short at one rung, and the same lanes held alike.
 * Their measures may differ.
 */
const isSameHealth = (a: MachineHealth, b: MachineHealth): boolean =>
  a.state === b.state &&
  a.treatments.length === b.treatments.length &&
  a.treatments.every((t, i) => {
    const u = b.treatments[i]
    return u?.lane === t.lane && u.treatment.kind === t.treatment.kind
  }) &&
  a.causes.length === b.causes.length &&
  a.causes.every((c, i) => {
    const d = b.causes[i]
    return (
      d !== undefined &&
      causeKey(c) === causeKey(d) &&
      (c.kind !== "unsampled" ||
        (d.kind === "unsampled" && c.reason === d.reason)) &&
      (c.kind !== "memory-short" ||
        (d.kind === "memory-short" && c.rung === d.rung))
    )
  })

/** What a sample, or its failure, gave. */
export type SampleResult =
  | {
      readonly kind: "sampled"
      readonly sample: MachineSample
      /** Each lane's and service's cgroup that met its limit since the last sample (`limitEvents`). */
      readonly atLimit: readonly CauseLimitEvent[]
    }
  | { readonly kind: "failed"; readonly error: string }

/** What memory's rung and the lanes held add to the health value. */
export interface MemoryShort {
  readonly rung: Rung
  /** Observing, a host holds no lane, and says only that memory is short. */
  readonly isHolding: boolean
  readonly held: readonly HeldLane[]
}

export const MEMORY_CALM: MemoryShort = { rung: 0, isHolding: true, held: [] }

export const NOTHING_BESIDE: Beside = { memory: MEMORY_CALM, repair: null }

export interface Planned {
  readonly health: MachineHealth
  readonly state: HealthPlanState
  /**
   * `health` says something the last did not: its state, or a cause
   * entered or left. A cause's measures changing alone is no change, so
   * the record is not rewritten each sample.
   */
  readonly changed: boolean
  /** The events this sample saw: an OOM kill, a stall. None for a failed sample. */
  readonly seen: readonly MachineCause[]
}

/**
 * The health value after one sample, from what the samples before it left
 * in `state`, and what `beside` says, planned beside it (`planRung`,
 * `planTreatments`, `repairCause`). A failed sample changes no
 * count: its causes stay as they were, with `unsampled` beside them until a
 * sample reads.
 */
export function planHealth(
  state: HealthPlanState,
  result: SampleResult,
  settings: Pick<StoreSettings, "leaveFree" | "max">,
  capabilities: StoreCapabilities,
  beside: Beside,
): Planned {
  if (result.kind === "failed") {
    const health = rankedHealth(
      [
        ...activeCauses(state.causes),
        { kind: "unsampled", reason: "failed", error: result.error },
      ],
      beside,
    )
    return plannedHealth(state, state, health, [])
  }
  const { sample } = result
  const next = new Map<string, Tracked<MachineCause>>()
  const levels: readonly [string, CauseReading][] = [
    ...roomReadings(sample, settings, capabilities),
    ["filesystem-low", filesystemReading(sample, settings)],
    ...upkeepReadings(sample, capabilities),
    ...atLimitReadings(state.causes, result.atLimit),
  ]
  for (const [key, r] of levels) {
    const stepped = nextLevelState(state.causes.get(key), r)
    if (stepped !== null) next.set(key, stepped)
  }

  const { lanes } = sample
  const oomKills = new Map(lanes.map(l => [l.lane, l.oomKills]))
  const events: MachineCause[] = [
    ...lanes
      .filter(lane => {
        const before = state.oomKills.get(lane.lane)
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
    ...[...state.causes]
      .filter(([, t]) => EVENT_KINDS.has(t.value.kind))
      .map(([key]) => key),
  ])
  for (const key of eventKeys) {
    const stepped = nextEventState(state.causes.get(key), seen.get(key) ?? null)
    if (stepped !== null) next.set(key, stepped)
  }

  const health = rankedHealth(activeCauses(next), beside)
  return plannedHealth(
    state,
    { causes: next, oomKills, health },
    health,
    events,
  )
}

/**
 * The health value once no sample has ended for the overdue bound: the
 * causes kept, as a failed sample keeps them, `unsampled` (`overdue`)
 * beside them, and `beside` as the manager says it now (nothing held).
 */
export function planOverdueHealth(
  state: HealthPlanState,
  beside: Beside,
): Planned {
  const health = rankedHealth(
    [
      ...activeCauses(state.causes),
      { kind: "unsampled", reason: "overdue", error: null },
    ],
    beside,
  )
  return plannedHealth(state, state, health, [])
}

const activeCauses = (
  causes: ReadonlyMap<string, Tracked<MachineCause>>,
): readonly MachineCause[] =>
  [...causes.values()].filter(t => t.active).map(t => t.value)

function plannedHealth(
  before: HealthPlanState,
  after: HealthPlanState,
  health: MachineHealth,
  seen: readonly MachineCause[],
): Planned {
  const changed = !isSameHealth(before.health, health)
  return {
    health,
    state: { ...after, health: changed ? health : before.health },
    changed,
    seen,
  }
}
