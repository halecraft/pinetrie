// interface/health-page — the Health page, decided: what the footer's
// status opens. `healthPageView` decides, from the host's facts (`GET
// /machine`), the board's archive moves and the time now, the verdict,
// each vital judged against the bounds pine·trie acts at, the threads,
// what happened folded, and the details. `health-words.ts` words it, for
// the page and the host's diagnostics alike.

import {
  type ActingBound,
  assertNever,
  boundReading,
  type Containment,
  type EventMeasured,
  type HistoryMinute,
  type MachineAction,
  type MachineCause,
  type MachineCauseKind,
  type MachineFacts,
  type MachineHistory,
  type MachineKind,
  type MachineLane,
  type MachineLately,
  type MachineSampled,
  type MachineState,
  type Measured,
  type ServiceReading,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import type { ThreadMove } from "./thread-card.ts"

export type VitalName = "memory" | "pressure" | "store" | "filesystem"

/** A vital as judged: by its cause, its bounds, or whose stall it is. */
export type VitalStatus =
  | { readonly kind: "normal" }
  /** Past the first bound's `clears` it reaches, with no cause in force. */
  | { readonly kind: "near"; readonly bound: ActingBound }
  | { readonly kind: "acting"; readonly cause: MachineCause }
  /** The pressure is a stall inside one thread's own limit, which no rung reads. */
  | { readonly kind: "contained" }
  | { readonly kind: "not-read"; readonly why: string }

/**
 * Which vital each cause belongs to; null for one shown only in the verdict
 * and in what happened. A cause added to core fails here until placed.
 */
const VITAL_CAUSES: Readonly<Record<MachineCauseKind, VitalName | null>> = {
  "memory-short": "memory",
  "room-low": "store",
  "room-spent": "store",
  "metadata-full": "store",
  "freeing-room": "store",
  "room-unrecoverable": "store",
  "disk-being-repaired": "store",
  "disk-repair-failed": "store",
  "filesystem-low": "filesystem",
  "lane-oom-killed": null,
  "service-oom-killed": null,
  "cgroup-at-limit": null,
  "host-stalls": null,
  "snapshot-skipped": null,
  unsampled: null,
}

/** A bar, any client's: what is used, 0 to 1, stacked; where each bound's mark is; and the first bound's near zone. */
export interface BarView {
  readonly fills: readonly number[]
  readonly marks: readonly number[]
  readonly near: { readonly from: number; readonly to: number } | null
}

/** A series, any client's: each minute 0 to 1 of its top, the bounds' lines, and the minutes a thread's own stall marks. */
export interface SeriesView {
  readonly points: readonly (number | null)[]
  readonly lines: readonly number[]
  readonly contained: readonly boolean[]
  /** The least and most read, and the newest, in the reading's unit; null with none read. */
  readonly range: {
    readonly least: number
    readonly most: number
    readonly now: number
  } | null
}

export interface VitalView {
  readonly name: VitalName
  /** The reading, and what it is out of; null where it was not read. */
  readonly reading: { readonly value: number; readonly total: number } | null
  readonly bounds: readonly ActingBound[]
  readonly status: VitalStatus
  readonly bar: BarView | null
  readonly series: SeriesView | null
}

/** A running lane's row: its facts, its archive, and a cause naming it. */
export interface ThreadRow extends MachineLane {
  /** The board's move of its canvas to the archive; null where none is offered. */
  readonly archive: Pick<ThreadMove, "busy" | "drops" | "intent"> | null
  /** A cause that names its lane: killed for memory, or at its limit. */
  readonly trouble: MachineCause | null
  readonly bar: BarView | null
  readonly series: SeriesView | null
}

export interface ServiceRow extends ServiceReading {
  readonly atLimit: boolean
  readonly bar: BarView | null
}

/** One of what happened, its repeats in a row folded into it. */
export interface HappenedRow {
  /** The newest of them, carrying the sums or the longest time a fold keeps. */
  readonly lately: MachineLately
  readonly count: number
  readonly tone: HappenedTone
}

export type HappenedTone = "trouble" | "info"

export type HealthPageView =
  /** The host runs no lanes, and reads no machine. */
  | { readonly kind: "no-machine" }
  | {
      readonly kind: "machine"
      readonly machineKind: MachineKind
      readonly state: MachineState
      /** Worst first. */
      readonly causes: readonly MachineCause[]
      /** How many lanes are held for memory: what a memory-short cause's words count. */
      readonly heldForMemory: number
      /** Null before the first sample. */
      readonly sampled: MachineSampled | null
      readonly vitals: Readonly<Record<VitalName, VitalView>>
      /** Held first, then by name. */
      readonly threads: readonly ThreadRow[]
      readonly services: readonly ServiceRow[]
      readonly containment: Containment | null
      readonly vmMemoryCeilingBytes: number | null
      /** The services' floor this host asks for; null where it keeps none. */
      readonly servicesFloorBytes: number | null
      readonly isOomdManagingLanes: boolean
      readonly happened: readonly HappenedRow[]
      /** The strip's span, and each of what happened on it, 0 to 1, unfolded. */
      readonly strip: {
        readonly from: number
        readonly to: number
        readonly isCapped: boolean
        readonly marks: readonly {
          readonly at: number
          readonly tone: HappenedTone
        }[]
      }
      readonly names: ReadonlyMap<ThreadId, ThreadName>
      /** Offered only where the facts carry it: this host holds the repair's controls, and it failed. */
      readonly repairAgain: { readonly why: string } | null
      readonly now: number
    }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A vital's status: not read; a cause of it in force; the pressure past a
 * bound while memory acts; a stall that is a thread's own; near; normal.
 * A reading over a bound with no cause reads near: a level enters only
 * after samples running, and the page never says pine·trie acts before
 * the footer does.
 */
export function vitalStatus(
  name: VitalName,
  reading: number | null,
  bounds: readonly ActingBound[],
  causes: readonly MachineCause[],
  why: string | null,
  isContained = false,
): VitalStatus {
  if (reading === null)
    return { kind: "not-read", why: why ?? "waiting for its first reading" }
  const own = (vital: VitalName) =>
    causes.find(c => VITAL_CAUSES[c.kind] === vital)
  const cause = own(name)
  if (cause !== undefined) return { kind: "acting", cause }
  const reached = bounds.find(b => boundReading(reading, b) !== "clear")
  if (name === "pressure") {
    if (isContained) return { kind: "contained" }
    const memory = own("memory")
    if (
      memory !== undefined &&
      bounds.some(b => boundReading(reading, b) === "over")
    )
      return { kind: "acting", cause: memory }
  }
  return reached === undefined
    ? { kind: "normal" }
    : { kind: "near", bound: reached }
}

/** Where `value` of `total` sits on a bar, 0 to 1, the bar filling as the worse side nears. */
const barShare = (value: number, total: number, worse: "below" | "above") =>
  total <= 0
    ? 0
    : Math.min(
        1,
        Math.max(0, worse === "below" ? 1 - value / total : value / total),
      )

/** A bar of what is used of `total`, its bounds' marks, and the first's near zone. */
function boundBar(
  value: number,
  total: number,
  bounds: readonly ActingBound[],
): BarView {
  const first = bounds[0]
  return {
    fills: [barShare(value, total, first?.worse ?? "below")],
    marks: bounds.map(b => barShare(b.acts, total, b.worse)),
    near:
      first === undefined
        ? null
        : {
            from: barShare(first.clears, total, first.worse),
            to: barShare(first.acts, total, first.worse),
          },
  }
}

/**
 * A series of `read` from each minute, scaled to `top`, with `lines` drawn
 * across it, all in the reading's unit; `showsContained` marks the minutes
 * whose stall was a thread's own, which only the pressure's series reads.
 */
function seriesView(
  history: MachineHistory,
  read: (minute: HistoryMinute) => number | null,
  top: number,
  lines: readonly number[] = [],
  showsContained = false,
): SeriesView {
  const values = history.minutes.map(m => (m === null ? null : read(m)))
  const known = values.filter(v => v !== null)
  const newest = known.at(-1)
  const scale = (v: number) => (top <= 0 ? 0 : Math.min(1, v / top))
  return {
    points: values.map(v => (v === null ? null : scale(v))),
    lines: lines.map(scale),
    contained: history.minutes.map(
      m => showsContained && (m?.isContainedStall ?? false),
    ),
    range:
      newest === undefined
        ? null
        : {
            least: Math.min(...known),
            most: Math.max(...known),
            now: newest,
          },
  }
}

const notRead = (m: Measured<unknown>): string | null =>
  m.kind === "unreadable" ? m.why : null

function vitalsView(
  sampled: MachineSampled | null,
  causes: readonly MachineCause[],
): Readonly<Record<VitalName, VitalView>> {
  const vital = (
    name: VitalName,
    reading: VitalView["reading"],
    bounds: readonly ActingBound[],
    why: string | null,
    series: SeriesView | null = null,
    isContained = false,
  ): VitalView => ({
    name,
    reading,
    bounds,
    status: vitalStatus(
      name,
      reading?.value ?? null,
      bounds,
      causes,
      why,
      isContained,
    ),
    bar:
      reading === null || name === "pressure"
        ? null
        : boundBar(reading.value, reading.total, bounds),
    series,
  })
  if (sampled === null)
    return {
      memory: vital("memory", null, [], null),
      pressure: vital("pressure", null, [], null),
      store: vital("store", null, [], null),
      filesystem: vital("filesystem", null, [], null),
    }
  const { memory, store, filesystem, history } = sampled
  const { pressure } = memory
  const pressureBounds = pressure.kind === "read" ? pressure.bounds : []
  // Room above the highest bound or reading, so neither draws on the edge.
  const pressureTop =
    1.25 *
    Math.max(
      ...pressureBounds.map(b => b.acts),
      ...history.minutes.map(m => m?.machinePressureFull ?? 0),
    )
  return {
    memory: vital(
      "memory",
      { value: memory.availableBytes, total: memory.totalBytes },
      memory.bounds,
      null,
      seriesView(
        history,
        m => memory.totalBytes - m.memoryAvailableBytes,
        memory.totalBytes,
        memory.bounds.map(b => memory.totalBytes - b.acts),
      ),
    ),
    pressure: vital(
      "pressure",
      pressure.kind === "read"
        ? { value: pressure.fullAvg10, total: 100 }
        : null,
      pressureBounds,
      notRead(pressure),
      pressure.kind === "read"
        ? seriesView(
            history,
            m => m.machinePressureFull,
            pressureTop,
            pressureBounds.map(b => b.acts),
            true,
          )
        : null,
      pressure.kind === "read" && pressure.scope === "contained",
    ),
    store: vital(
      "store",
      store.kind === "read"
        ? { value: store.unallocatedBytes, total: store.sizeBytes }
        : null,
      store.kind === "read" ? store.bounds : [],
      notRead(store),
    ),
    filesystem: vital(
      "filesystem",
      filesystem.kind === "read"
        ? { value: filesystem.freeBytes, total: filesystem.sizeBytes }
        : null,
      filesystem.kind === "read" ? filesystem.bounds : [],
      notRead(filesystem),
    ),
  }
}

/** The cause that names a lane, if any: killed for memory, or stuck at its limit. */
const laneTrouble = (
  lane: ThreadId,
  causes: readonly MachineCause[],
): MachineCause | null =>
  causes.find(
    c =>
      (c.kind === "lane-oom-killed" && c.lane === lane) ||
      (c.kind === "cgroup-at-limit" &&
        c.subject.kind === "lane" &&
        c.subject.lane === lane),
  ) ?? null

function threadRow(
  l: MachineLane,
  causes: readonly MachineCause[],
  history: MachineHistory | null,
  archive: ThreadMove | null,
): ThreadRow {
  const { memory } = l
  const top =
    memory.kind === "read"
      ? (memory.limitBytes ??
        Math.max(
          memory.currentBytes,
          ...(history?.minutes ?? []).map(m => m?.laneBytes[l.lane] ?? 0),
        ))
      : 0
  return {
    ...l,
    archive: archive?.closes === true ? archive : null,
    trouble: laneTrouble(l.lane, causes),
    bar:
      memory.kind === "read" && top > 0
        ? {
            fills: [memory.anonBytes / top, memory.fileBytes / top],
            marks: [],
            near: null,
          }
        : null,
    series:
      history === null || top <= 0
        ? null
        : seriesView(history, m => m.laneBytes[l.lane] ?? null, top),
  }
}

/** The fold key of one of what happened: repeats in a row of one key fold; null never folds. */
function happenedKey(l: MachineLately): string | null {
  if (l.kind !== "event") return null
  const { event } = l
  switch (event.kind) {
    case "host-stalled":
    case "snapshots-deleted":
    case "repair-asked-again":
      return event.kind
    case "slow-command":
      return `${event.kind}:${event.program}:${event.subcommand ?? ""}`
    case "slow-step":
      return `${event.kind}:${event.where ?? ""}`
    case "lane-oom-killed":
      return `${event.kind}:${event.lane}`
    case "service-oom-killed":
      return `${event.kind}:${event.service}`
    case "cgroup-at-limit":
      return `${event.kind}:${event.subject.kind === "lane" ? event.subject.lane : event.subject.kind === "service" ? event.subject.service : "own"}`
    default:
      return assertNever(event)
  }
}

/** Two events of one key as one: counts and bytes summed, the longest time kept. */
function foldedEvent(
  newer: EventMeasured,
  older: EventMeasured,
): EventMeasured {
  if (newer.kind === "snapshots-deleted" && older.kind === "snapshots-deleted")
    return {
      ...newer,
      count: newer.count + older.count,
      bytes: newer.bytes + older.bytes,
    }
  if (newer.kind === "cgroup-at-limit" && older.kind === "cgroup-at-limit")
    return {
      ...newer,
      maxHits: newer.maxHits + older.maxHits,
      highHits: newer.highHits + older.highHits,
    }
  if ("ms" in newer && "ms" in older)
    return { ...newer, ms: Math.max(newer.ms, older.ms) }
  return newer
}

/** What each event says of the machine: trouble, or what pine·trie did. */
const EVENT_TONES: Readonly<Record<EventMeasured["kind"], HappenedTone>> = {
  "lane-oom-killed": "trouble",
  "service-oom-killed": "trouble",
  "cgroup-at-limit": "trouble",
  "host-stalled": "trouble",
  "snapshots-deleted": "info",
  "repair-asked-again": "info",
  "slow-step": "info",
  "slow-command": "info",
}

function happenedTone(l: MachineLately): HappenedTone {
  switch (l.kind) {
    case "event":
      return EVENT_TONES[l.event.kind]
    case "treatment":
      return l.to === "normal" ? "info" : "trouble"
    case "rung":
      return l.to > l.from ? "trouble" : "info"
    case "repair":
      return l.to === "failed" ? "trouble" : "info"
    default:
      return assertNever(l)
  }
}

/** What happened, newest first, each run of one key folded into its newest. */
export function foldRepeats(
  lately: readonly MachineLately[],
): readonly HappenedRow[] {
  const rows: HappenedRow[] = []
  for (const l of lately) {
    const last = rows.at(-1)
    const key = happenedKey(l)
    if (
      last !== undefined &&
      key !== null &&
      key === happenedKey(last.lately) &&
      last.lately.kind === "event" &&
      l.kind === "event"
    ) {
      rows[rows.length - 1] = {
        ...last,
        lately: {
          ...last.lately,
          event: foldedEvent(last.lately.event, l.event),
        },
        count: last.count + 1,
      }
      continue
    }
    rows.push({ lately: l, count: 1, tone: happenedTone(l) })
  }
  return rows
}

/** A service, against its limit, and whether a cause says it met it. */
function serviceRow(
  s: ServiceReading,
  causes: readonly MachineCause[],
): ServiceRow {
  const { memory } = s
  return {
    ...s,
    atLimit: causes.some(
      c =>
        (c.kind === "service-oom-killed" && c.service === s.service) ||
        (c.kind === "cgroup-at-limit" &&
          c.subject.kind === "service" &&
          c.subject.service === s.service),
    ),
    bar:
      memory.kind === "read" && memory.limitBytes !== null
        ? {
            fills: [Math.min(1, memory.currentBytes / memory.limitBytes)],
            marks: [],
            near: null,
          }
        : null,
  }
}

const repairAgainOf = (
  actions: readonly MachineAction[],
): { readonly why: string } | null => {
  const repair = actions.find(a => a.kind === "repair-again")
  return repair === undefined ? null : { why: repair.why }
}

/** The page, from the host's facts (null: no machine), the board's archive move for each lane's canvas, and the time now. */
export function healthPageView(
  facts: MachineFacts | null,
  archiveMove: (lane: ThreadId) => ThreadMove | null,
  now: number,
): HealthPageView {
  if (facts === null) return { kind: "no-machine" }
  const archives = facts.actions.some(a => a.kind === "archive")
  const sampled = facts.reading.kind === "sampled" ? facts.reading : null
  const causes = facts.health.causes
  const names = new Map(facts.names.map(n => [n.lane, n.name]))
  for (const l of sampled?.lanes ?? [])
    if (l.name !== null) names.set(l.lane, l.name)
  const threads = (sampled?.lanes ?? [])
    .map(l =>
      threadRow(
        l,
        causes,
        sampled?.history ?? null,
        archives ? archiveMove(l.lane) : null,
      ),
    )
    .sort(
      (a, b) =>
        Number(b.treatment !== "normal") - Number(a.treatment !== "normal") ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    )
  const oldest = facts.lately.at(-1)?.at
  const from =
    facts.latelyCapped && oldest !== undefined ? oldest : now - DAY_MS
  const span = Math.max(1, now - from)
  return {
    kind: "machine",
    machineKind: facts.machineKind,
    state: facts.health.state,
    causes,
    heldForMemory: facts.health.treatments.filter(
      t => t.treatment.kind !== "waiting-for-repair",
    ).length,
    sampled,
    vitals: vitalsView(sampled, causes),
    threads,
    services: (sampled?.services ?? []).map(s => serviceRow(s, causes)),
    containment: sampled?.containment ?? null,
    vmMemoryCeilingBytes: facts.vmMemoryCeilingBytes,
    servicesFloorBytes: facts.servicesFloorBytes,
    isOomdManagingLanes: facts.isOomdManagingLanes,
    happened: foldRepeats(facts.lately),
    strip: {
      from,
      to: now,
      isCapped: facts.latelyCapped,
      marks: facts.lately
        .filter(l => l.at >= from)
        .map(l => ({
          at: Math.min(1, (l.at - from) / span),
          tone: happenedTone(l),
        })),
    },
    names,
    repairAgain: repairAgainOf(facts.actions),
    now,
  }
}
