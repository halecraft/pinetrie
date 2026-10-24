// machine/measurements — what the host keeps of the machine to tune the
// memory rungs by: its samples and the machine's reclaim, each lane's
// memory and program, each `bash` call's duration, every treatment changed
// or shadow decision, and the events no decision holds (`EventMeasured`),
// each row a value built here from what was planned; the host's store
// stamps its time. No command's arguments or output is kept: only its
// program.

import {
  assertNever,
  type CauseLimitSubject,
  type CgroupLimitHits,
  type EventMeasured,
  type HeldLane,
  type LaneTreatment,
  MACHINE_SAMPLE_MS,
  type MachineCause,
  type MachineReclaim,
  type MachineService,
  type MemoryCounters,
  type MemorySource,
  type ThreadId,
} from "@pinetrie/core"
import { READING_OVERDUE_AFTER_TICKS } from "./freshness.ts"
import {
  METADATA_CLEAR,
  METADATA_FULL,
  ROOM_SPENT,
  ROOM_SPENT_CLEAR,
} from "./health.ts"
import { ENTER_AFTER, LEAVE_AFTER } from "./hysteresis.ts"
import type { ManageMode } from "./manager.ts"
import type { PressureScope } from "./pressure-scope.ts"
import type { RepairState } from "./repair.ts"
import { RUNG_BOUNDS, type Rung } from "./rung.ts"
import type { LaneSample, MachineSample } from "./sample.ts"
import {
  MINIMUM_UNALLOCATED_FLOOR,
  MINIMUM_UNALLOCATED_PERCENT,
} from "./store-settings.ts"
import type { ShadowDecision } from "./treatments.ts"

/** Words a statement starts with that are not its program: `env X=1 time pnpm` runs `pnpm`. */
const PREFIXES = new Set(["env", "time", "exec", "nice", "nohup", "command"])
/** Statements that run no program worth naming. */
const NOT_PROGRAMS = new Set(["cd", "export", "pushd", "popd", "set"])

/** The prefixes' options that take the next word as their value: `env -u NAME`, `nice -n 10`. */
const OPTIONS_WITH_VALUES = new Set([
  "-u",
  "-C",
  "-S",
  "-n",
  "--unset",
  "--chdir",
])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The program a shell command runs: the first word of its first statement
 * that is not `cd`, `export` or assignments alone, past `env`, `time` and
 * the like and their assignments, flags and flags' values; its last path segment, so a
 * path names no directory. Never an argument. Null for none.
 */
export function commandProgram(command: string): string | null {
  for (const statement of command.split(/&&|\|\||[;|\n&]/)) {
    const words = statement
      .trim()
      .split(/\s+/)
      .map(w => w.replace(/^[({"']+|[)}"']+$/g, ""))
      .filter(w => w !== "")
    let afterPrefix = false
    let at = 0
    for (; at < words.length; at++) {
      const word = words[at] ?? ""
      if (PREFIXES.has(word)) afterPrefix = true
      else if (afterPrefix && OPTIONS_WITH_VALUES.has(word)) at++
      else if (!ASSIGNMENT.test(word) && !(afterPrefix && word.startsWith("-")))
        break
    }
    const program = words[at]
    if (
      program === undefined ||
      program.startsWith("-") ||
      NOT_PROGRAMS.has(program)
    )
      continue
    const name = program.split("/").at(-1)
    if (name !== undefined && name !== "") return name
  }
  return null
}

/** A sample as the measurements keep it. Sizes in bytes, stall time in µs, reclaim in stalls and pages scanned. */
export interface SampleMeasured {
  readonly rung: Rung
  readonly someAvg10: number | null
  readonly fullAvg10: number | null
  readonly memoryTotal: number
  readonly memoryAvailable: number
  readonly source: MemorySource
  /** The kernel's counters' rise since the last sample read them; null for none to compare. */
  readonly since: MemoryCounters | null
  /** The machine's reclaim's rise since the last sample read it; null for none to compare, as on an own-cgroup read. */
  readonly reclaim: MachineReclaim | null
  /** What its pressure was read as: the machine's, contained in cgroups at their limits, or unmeasured. */
  readonly scope: PressureScope["kind"]
  readonly lanesRunning: number
  readonly mode: ManageMode
}

/** A running lane's memory, in MiB so a lane is kept only when it moved by one, and the program it runs. */
export interface LaneMeasured {
  readonly lane: ThreadId
  readonly anonMiB: number
  readonly fileMiB: number
  readonly currentMiB: number
  readonly limitMiB: number | null
  readonly program: string | null
}

/** A treatment changed, or a shadow decision, with the pressure and memory it was made at. */
export type DecisionMeasured = {
  readonly fullAvg10: number | null
  readonly memoryAvailable: number
} & (
  | {
      readonly kind: "treatment"
      readonly lane: ThreadId
      readonly from: LaneTreatment["kind"]
      readonly to: LaneTreatment["kind"]
    }
  | { readonly kind: "shadow"; readonly decision: ShadowDecision }
  /** The lane VM's repair moved, this host's own. */
  | {
      readonly kind: "repair"
      readonly from: RepairState["kind"]
      readonly to: RepairState["kind"]
    }
)

/** The events a sample's causes saw that the measurements keep: OOM kills, and the host's stall. */
export const causeEvents = (
  seen: readonly MachineCause[],
): readonly EventMeasured[] =>
  seen.flatMap((c): EventMeasured[] => {
    switch (c.kind) {
      case "lane-oom-killed":
        return [{ kind: "lane-oom-killed", lane: c.lane }]
      case "service-oom-killed":
        return [{ kind: "service-oom-killed", service: c.service }]
      case "host-stalls":
        return [{ kind: "host-stalled", ms: c.stalledMs }]
      default:
        return []
    }
  })

/** The rise of each counter from `before` to `now`; null when either is missing or one fell, as at a reboot. */
function countersRise<K extends string>(
  before: Readonly<Record<K, number>> | null,
  now: Readonly<Record<K, number>> | null,
): Record<K, number> | null {
  if (before === null || now === null) return null
  const names = Object.keys(now) as K[]
  const rise = names.map(name => [name, now[name] - before[name]] as const)
  return rise.some(([, v]) => v < 0)
    ? null
    : (Object.fromEntries(rise) as Record<K, number>)
}

/** The kernel's memory counters' rise; null when either is missing or one fell, as at a reboot. */
export const counterRise = (
  before: MemoryCounters | null,
  now: MemoryCounters | null,
): MemoryCounters | null => countersRise(before, now)

/** The machine's reclaim's rise; null when either is missing or one fell, as at a reboot. */
export const reclaimRise = (
  before: MachineReclaim | null,
  now: MachineReclaim | null,
): MachineReclaim | null => countersRise(before, now)

/** What `limitEvents` reads of a sample: each cgroup's limit hits. */
export type LimitsRead = Pick<MachineSample, "lanes" | "services"> & {
  readonly machine: Pick<MachineSample["machine"], "limitHits">
}

/** A lane's or a service's cgroup that met its limit since the last sample: what a cause may name. */
export type CauseLimitEvent = Extract<
  EventMeasured,
  { readonly kind: "cgroup-at-limit" }
> & { readonly subject: CauseLimitSubject }

/** The cgroups at their limits since the last sample: the lanes' and services', and a host in a lane's own apart. */
export interface LimitEvents {
  readonly causes: readonly CauseLimitEvent[]
  /** The own cgroup's rise, when one rose: recorded, and never a cause's subject. */
  readonly own: CgroupLimitHits | null
}

/** Each lane's and service's cgroup a sample read the limit hits of, by its subject. */
function causeLimitHitsRead(read: LimitsRead): readonly {
  readonly subject: CauseLimitSubject
  readonly hits: CgroupLimitHits
}[] {
  return [
    ...read.lanes.map(l => ({
      subject: { kind: "lane", lane: l.lane } as const,
      hits: l.limitHits,
    })),
    ...read.services.flatMap(s =>
      s.memory.kind === "read"
        ? [
            {
              subject: { kind: "service", service: s.service } as const,
              hits: s.memory.limitHits,
            },
          ]
        : [],
    ),
  ]
}

const subjectKey = (subject: CauseLimitSubject): string => {
  switch (subject.kind) {
    case "lane":
      return `lane:${subject.lane}`
    case "service":
      return `service:${subject.service}`
    default:
      return assertNever(subject)
  }
}

/** How far `now`'s `max` and `high` rose over `then`; null when neither rose, or one fell (a cgroup made again). */
function hitsRise(
  then: CgroupLimitHits | null | undefined,
  now: CgroupLimitHits,
): CgroupLimitHits | null {
  if (then == null) return null
  const max = now.max - then.max
  const high = now.high - then.high
  return max < 0 || high < 0 || max + high === 0 ? null : { max, high }
}

/**
 * One event per lane's or service's cgroup whose `max` or `high` count
 * rose from `before` to `now`, and a host in a lane's own cgroup's rise
 * apart: on such a host its limit is the shortage memory's rung names, so
 * it is no cause's subject. A cgroup new in `now`, or whose counts fell (a
 * container made again), has no rise yet.
 */
export function limitEvents(
  before: LimitsRead | null,
  now: LimitsRead,
): LimitEvents {
  if (before === null) return { causes: [], own: null }
  const was = new Map(
    causeLimitHitsRead(before).map(r => [subjectKey(r.subject), r.hits]),
  )
  return {
    causes: causeLimitHitsRead(now).flatMap(
      ({ subject, hits }): CauseLimitEvent[] => {
        const rise = hitsRise(was.get(subjectKey(subject)), hits)
        return rise === null
          ? []
          : [
              {
                kind: "cgroup-at-limit",
                subject,
                maxHits: rise.max,
                highHits: rise.high,
              },
            ]
      },
    ),
    own:
      now.machine.limitHits === null
        ? null
        : hitsRise(before.machine.limitHits, now.machine.limitHits),
  }
}

/** Every event of `limitEvents`, as the measurements keep them: the own cgroup's among them. */
export const limitEventsMeasured = (
  events: LimitEvents,
): readonly EventMeasured[] => [
  ...events.causes,
  ...(events.own === null
    ? []
    : [
        {
          kind: "cgroup-at-limit",
          subject: { kind: "own" },
          maxHits: events.own.max,
          highHits: events.own.high,
        } as const,
      ]),
]

/** The memory limits a host's containers are made with, as Docker's `--memory` takes them (`512m`). */
export interface MemoryLimits {
  readonly services: Readonly<Record<MachineService, string>>
  readonly lane: string
}

/** What the kernel holds a container of one kind to besides its memory, as the host makes it. */
export interface ContainerLimitsInForce {
  readonly processesMax: number
  readonly cpuShares: number
  readonly oomScoreAdj: number
  readonly parent: string
}

/**
 * Every number the host decides memory and room by, read from the
 * constants themselves so a tuned one shows in the next export, with the
 * sample's interval, the overdue bound, the containers' memory limits and
 * each kind's other limits this host runs with, and the services' floor it
 * asks for. Each is null on a host that has none.
 */
export function numbersInForce(inForce: {
  readonly sampleEveryMs: number
  readonly readingOverdueAfterTicks: number
  readonly memoryLimits: MemoryLimits | null
  readonly containerLimits: Readonly<
    Record<"lane" | MachineService, ContainerLimitsInForce>
  > | null
  readonly servicesFloorBytes: number | null
}) {
  return {
    RUNG_BOUNDS,
    ENTER_AFTER,
    LEAVE_AFTER,
    READING_OVERDUE_AFTER_TICKS,
    readingOverdueAfterTicks: inForce.readingOverdueAfterTicks,
    MACHINE_SAMPLE_MS,
    sampleEveryMs: inForce.sampleEveryMs,
    ROOM_SPENT,
    ROOM_SPENT_CLEAR,
    METADATA_FULL,
    METADATA_CLEAR,
    MINIMUM_UNALLOCATED_PERCENT,
    MINIMUM_UNALLOCATED_FLOOR,
    memoryLimits: inForce.memoryLimits,
    containerLimits: inForce.containerLimits,
    servicesFloorBytes: inForce.servicesFloorBytes,
  }
}

/** The numbers a host's measurements were planned by, as its export's first line names them. */
export type NumbersInForce = ReturnType<typeof numbersInForce>

const MiB = 1024 ** 2
const inMiB = (bytes: number) => Math.round(bytes / MiB)

/** Each running lane whose memory was read, as kept. */
export function lanesMeasured(
  lanes: readonly LaneSample[],
  programInFlight: (lane: ThreadId) => string | null,
): readonly LaneMeasured[] {
  return lanes.map(l => ({
    lane: l.lane,
    anonMiB: inMiB(l.anon),
    fileMiB: inMiB(l.file),
    currentMiB: inMiB(l.current),
    limitMiB: l.limit === null ? null : inMiB(l.limit),
    program: programInFlight(l.lane),
  }))
}

/** The lanes of `now` that differ from what `before` kept of each: the only ones stored. */
export const lanesChanged = (
  before: ReadonlyMap<ThreadId, LaneMeasured>,
  now: readonly LaneMeasured[],
): readonly LaneMeasured[] =>
  now.filter(l => {
    const was = before.get(l.lane)
    return (
      was === undefined ||
      was.anonMiB !== l.anonMiB ||
      was.fileMiB !== l.fileMiB ||
      was.currentMiB !== l.currentMiB ||
      was.limitMiB !== l.limitMiB ||
      was.program !== l.program
    )
  })

/** Each lane whose treatment differs between two plans' held lanes, from and to; a lane not held is `normal`. */
export function treatmentChanges(
  before: readonly HeldLane[],
  after: readonly HeldLane[],
): readonly {
  readonly lane: ThreadId
  readonly from: LaneTreatment["kind"]
  readonly to: LaneTreatment["kind"]
}[] {
  const kindIn = (held: readonly HeldLane[], lane: ThreadId) =>
    held.find(h => h.lane === lane)?.treatment.kind ?? "normal"
  const lanes = [...new Set([...before, ...after].map(h => h.lane))]
  return lanes.flatMap(lane => {
    const from = kindIn(before, lane)
    const to = kindIn(after, lane)
    return from === to ? [] : [{ lane, from, to }]
  })
}
