// host/machine/measurements — the machine's measurements in seven tables
// beside the documents' in the session's file, on the store's connection, as
// the snapshot index's are: each row stamped with the host's clock, kept for
// `MEASUREMENTS_KEPT_DAYS`, and exported as JSON lines under a first line
// naming what they were measured on and the numbers in force. No planner
// reads the time: it is for tuning the memory rungs later, from what was
// kept, and for the Machine page's Lately, decoded here (`recentRows`).

import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import {
  assertNever,
  type Containment,
  type EventMeasured,
  isThreadId,
  LANE_TREATMENTS,
  type LaneTreatment,
  type LimitSubject,
  MACHINE_SERVICES,
  type MachineLately,
  type MemorySource,
  REPAIR_STEPS,
  type RepairStep,
  TIMED_PROGRAMS,
} from "@pinetrie/core"
import type {
  DecisionMeasured,
  LaneMeasured,
  MachineMeasurements,
  NumbersInForce,
  SampleMeasured,
  StoreTarget,
} from "@pinetrie/machine"
import type { ShellCallEnded } from "./shell-calls.ts"

/** How long a row is kept, in days. */
export const MEASUREMENTS_KEPT_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** The tables, by the name each row carries in the export. */
const TABLES = {
  samples: "pinetrie_machine_samples",
  "lane-samples": "pinetrie_machine_lane_samples",
  "shell-calls": "pinetrie_machine_shell_calls",
  decisions: "pinetrie_machine_decisions",
  events: "pinetrie_machine_events",
  reclaim: "pinetrie_machine_reclaim",
  scopes: "pinetrie_machine_scopes",
} as const

/** How many of what happened the Machine page shows, newest first. */
export const RECENT_EVENTS_SHOWN = 50

/** Each event's stored kind: a kind added without one does not type-check. */
const EVENT_TAGS = {
  "lane-oom-killed": "lane-oom-killed",
  "service-oom-killed": "service-oom-killed",
  "snapshots-deleted": "snapshots-deleted",
  "host-stalled": "host-stalled",
  "repair-asked-again": "repair-asked-again",
  "slow-step": "slow-step",
  "slow-command": "slow-command",
  "cgroup-at-limit": "cgroup-at-limit",
} as const satisfies Record<EventMeasured["kind"], string>

/** An `events` row's columns after `at`: kind, subject, count, bytes, ms. */
type EventColumns = [
  string,
  string | null,
  number | null,
  number | null,
  number | null,
]

/** A cgroup at its limit's `subject`: `lane:<id>`, `service:<name>` or `own`. */
function limitSubjectText(subject: LimitSubject): string {
  switch (subject.kind) {
    case "lane":
      return `lane:${subject.lane}`
    case "service":
      return `service:${subject.service}`
    case "own":
      return "own"
    default:
      return assertNever(subject)
  }
}

/** A stored `subject` as the cgroup it names; null for one this version cannot read. */
function limitSubjectFromText(text: unknown): LimitSubject | null {
  if (text === "own") return { kind: "own" }
  if (typeof text !== "string" || !text.includes(":")) return null
  const colon = text.indexOf(":")
  const name = text.slice(colon + 1)
  switch (text.slice(0, colon)) {
    case "lane":
      return isThreadId(name) ? { kind: "lane", lane: name } : null
    case "service":
      return isOneOf(MACHINE_SERVICES, name)
        ? { kind: "service", service: name }
        : null
    default:
      return null
  }
}

/**
 * An event as its row: its kind's tag, and only the columns it has. A
 * cgroup at its limit keeps its `max` hits in `count` and its `high` hits
 * in `bytes`, the table's integer columns.
 */
function eventRow(e: EventMeasured): EventColumns {
  const tag = EVENT_TAGS[e.kind]
  switch (e.kind) {
    case "lane-oom-killed":
      return [tag, e.lane, null, null, null]
    case "service-oom-killed":
      return [tag, e.service, null, null, null]
    case "snapshots-deleted":
      return [tag, null, e.count, e.bytes, null]
    case "host-stalled":
      return [tag, null, null, null, e.ms]
    case "repair-asked-again":
      return [tag, null, null, null, null]
    case "slow-step":
      return [tag, e.where, null, null, e.ms]
    case "slow-command":
      return [
        tag,
        e.subcommand === null ? e.program : `${e.program} ${e.subcommand}`,
        null,
        null,
        e.ms,
      ]
    case "cgroup-at-limit":
      return [tag, limitSubjectText(e.subject), e.maxHits, e.highHits, null]
    default:
      return assertNever(e)
  }
}

const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v)

/** A stored `events` row as its event; null for a row no kind of this version reads. */
export function eventFromRow(
  row: Record<string, unknown>,
): EventMeasured | null {
  const { kind, subject, count, bytes, ms } = row
  switch (kind) {
    case EVENT_TAGS["lane-oom-killed"]:
      return typeof subject === "string" && isThreadId(subject)
        ? { kind, lane: subject }
        : null
    case EVENT_TAGS["service-oom-killed"]:
      return isOneOf(MACHINE_SERVICES, subject)
        ? { kind, service: subject }
        : null
    case EVENT_TAGS["snapshots-deleted"]:
      return isNumber(count) && isNumber(bytes) ? { kind, count, bytes } : null
    case EVENT_TAGS["host-stalled"]:
      return isNumber(ms) ? { kind, ms } : null
    case EVENT_TAGS["repair-asked-again"]:
      return { kind }
    case EVENT_TAGS["slow-step"]:
      return isNumber(ms) && (subject === null || typeof subject === "string")
        ? { kind, where: subject, ms }
        : null
    case EVENT_TAGS["slow-command"]: {
      if (!isNumber(ms) || typeof subject !== "string") return null
      const [program, ...rest] = subject.split(" ")
      return isOneOf(TIMED_PROGRAMS, program)
        ? {
            kind,
            program,
            subcommand: rest.length === 0 ? null : rest.join(" "),
            ms,
          }
        : null
    }
    case EVENT_TAGS["cgroup-at-limit"]: {
      const limited = limitSubjectFromText(subject)
      return limited !== null && isNumber(count) && isNumber(bytes)
        ? { kind, subject: limited, maxHits: count, highHits: bytes }
        : null
    }
    default:
      return null
  }
}

/** A stored `decisions` row as what happened: a treatment changed, or the repair moved; null for a shadow decision, or a row this version cannot read. */
export function decisionLately(
  row: Record<string, unknown>,
): MachineLately | null {
  const { at, kind, lane, from_treatment: from, to_treatment: to } = row
  if (!isNumber(at)) return null
  if (kind === "treatment") {
    const kinds: readonly LaneTreatment["kind"][] = LANE_TREATMENTS
    return typeof lane === "string" &&
      isThreadId(lane) &&
      isOneOf(kinds, from) &&
      isOneOf(kinds, to)
      ? { at, kind, lane, from, to }
      : null
  }
  if (kind === "repair") {
    const steps: readonly RepairStep[] = REPAIR_STEPS
    return isOneOf(steps, from) && isOneOf(steps, to)
      ? { at, kind, from, to }
      : null
  }
  return null
}

/** Each change of memory's rung between consecutive samples, oldest first. */
export function rungChanges(
  samples: readonly { readonly at: number; readonly rung: number }[],
): readonly Extract<MachineLately, { kind: "rung" }>[] {
  return samples.flatMap((s, i) => {
    const before = samples[i - 1]
    return before === undefined || before.rung === s.rung
      ? []
      : [{ at: s.at, kind: "rung" as const, from: before.rung, to: s.rung }]
  })
}

/** What the measurements were measured on: the export's first line, with its days. */
export interface MeasuredOn {
  /** The install's version; null where it could not be read. */
  readonly version: string | null
  readonly backend: StoreTarget | null
  readonly source: MemorySource | null
  readonly numbers: NumbersInForce
  /** What took effect of the containers' controls, as the latest sample read it; null before one, or with no machine. */
  readonly containment: Containment | null
  /** systemd-oomd may stop this host's lanes, outside pine·trie. */
  readonly isOomdManagingLanes: boolean
}

/** The export's first line: what its rows were measured on, the numbers in force among it, and its days. */
export const measurementsHeading = (on: MeasuredOn, days: number): string =>
  JSON.stringify({ ...on, days })

export interface HostMeasurements extends MachineMeasurements {
  /** A `bash` call ended: its lane, program, start and duration. */
  recordShellCall(call: ShellCallEnded): void
  /** Every row of the last `days` days, each a JSON line naming its table, oldest first within each: the lines under `measurementsHeading`'s. */
  exportRows(days: number): readonly string[]
  /**
   * The newest `limit` of what happened, newest first: treatments changed,
   * the repair's moves, the events, and memory's rung's changes.
   */
  recentRows(limit: number): readonly MachineLately[]
}

/** The measurements over `db`, the store's connection; their tables made if missing. `now` stamps each row. */
export function sqliteMachineMeasurements(
  db: DatabaseSync,
  now: () => number,
): HostMeasurements {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES.samples} (
    at INTEGER NOT NULL,
    rung INTEGER NOT NULL,
    some_avg10 REAL,
    full_avg10 REAL,
    memory_total INTEGER NOT NULL,
    memory_available INTEGER NOT NULL,
    source TEXT NOT NULL,
    refault_anon INTEGER,
    refault_file INTEGER,
    stall_some_us INTEGER,
    stall_full_us INTEGER,
    lanes_running INTEGER NOT NULL,
    mode TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES["lane-samples"]} (
    at INTEGER NOT NULL,
    lane TEXT NOT NULL,
    anon_mib INTEGER NOT NULL,
    file_mib INTEGER NOT NULL,
    current_mib INTEGER NOT NULL,
    limit_mib INTEGER,
    program TEXT
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES["shell-calls"]} (
    at INTEGER NOT NULL,
    lane TEXT NOT NULL,
    program TEXT,
    duration_ms INTEGER NOT NULL,
    outcome TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES.decisions} (
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    lane TEXT NOT NULL,
    from_treatment TEXT,
    to_treatment TEXT,
    would_free_bytes INTEGER,
    program TEXT,
    full_avg10 REAL,
    memory_available INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES.events} (
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    subject TEXT,
    count INTEGER,
    bytes INTEGER,
    ms INTEGER
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES.reclaim} (
    at INTEGER NOT NULL,
    alloc_stalls INTEGER NOT NULL,
    scanned_direct INTEGER NOT NULL,
    scanned_by_kswapd INTEGER NOT NULL
  )`)
  // Its own table, not a column of the samples': a person's store already
  // holds the samples' table, and no stored table changes shape.
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLES.scopes} (
    at INTEGER NOT NULL,
    scope TEXT NOT NULL
  )`)
  for (const table of Object.values(TABLES))
    db.exec(`CREATE INDEX IF NOT EXISTS ${table}_at ON ${table} (at)`)

  const insertSample = db.prepare(
    `INSERT INTO ${TABLES.samples} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertLane = db.prepare(
    `INSERT INTO ${TABLES["lane-samples"]} VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertCall = db.prepare(
    `INSERT INTO ${TABLES["shell-calls"]} VALUES (?, ?, ?, ?, ?)`,
  )
  const insertDecision = db.prepare(
    `INSERT INTO ${TABLES.decisions} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertEvent = db.prepare(
    `INSERT INTO ${TABLES.events} VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertReclaim = db.prepare(
    `INSERT INTO ${TABLES.reclaim} VALUES (?, ?, ?, ?)`,
  )
  const insertScope = db.prepare(`INSERT INTO ${TABLES.scopes} VALUES (?, ?)`)
  const recentDecisions = db.prepare(
    `SELECT * FROM ${TABLES.decisions} WHERE kind IN ('treatment', 'repair') ORDER BY at DESC LIMIT ?`,
  )
  const recentEvents = db.prepare(
    `SELECT * FROM ${TABLES.events} ORDER BY at DESC LIMIT ?`,
  )
  // The rung's changes, read once from the samples kept and then followed
  // as each is recorded: a read of every sample at each of the page's asks
  // would hold the host's thread for tens of ms.
  const kept = db
    .prepare(`SELECT at, rung FROM ${TABLES.samples} ORDER BY at`)
    .all() as { at: number; rung: number }[]
  let rungs = [...rungChanges(kept)]
  let lastRung = kept.at(-1)?.rung ?? null
  const trims = Object.values(TABLES).map(t =>
    db.prepare(`DELETE FROM ${t} WHERE at < ?`),
  )
  const reads = Object.entries(TABLES).map(
    ([name, table]) =>
      [
        name,
        db.prepare(`SELECT * FROM ${table} WHERE at >= ? ORDER BY at`),
      ] as const,
  )

  const decisionRow = (d: DecisionMeasured): SQLInputValue[] => {
    const at = [d.fullAvg10, d.memoryAvailable]
    if (d.kind === "treatment")
      return [d.kind, d.lane, d.from, d.to, null, null, ...at]
    // The repair is the lane VM's, no lane's: its states in the treatments' columns.
    if (d.kind === "repair")
      return [d.kind, "", d.from, d.to, null, null, ...at]
    const s = d.decision
    return s.kind === "kill"
      ? [s.kind, s.lane, null, null, null, s.program, ...at]
      : [s.kind, s.lane, null, null, s.wouldFreeBytes, null, ...at]
  }

  return {
    recordSample(row: SampleMeasured) {
      const { since, reclaim } = row
      const at = now()
      if (lastRung !== null && lastRung !== row.rung)
        rungs.push({ at, kind: "rung", from: lastRung, to: row.rung })
      lastRung = row.rung
      insertSample.run(
        at,
        row.rung,
        row.someAvg10,
        row.fullAvg10,
        row.memoryTotal,
        row.memoryAvailable,
        row.source,
        since?.refaultAnon ?? null,
        since?.refaultFile ?? null,
        since?.stallSomeUs ?? null,
        since?.stallFullUs ?? null,
        row.lanesRunning,
        row.mode,
      )
      if (reclaim !== null)
        insertReclaim.run(
          at,
          reclaim.allocStalls,
          reclaim.scannedDirect,
          reclaim.scannedByKswapd,
        )
      insertScope.run(at, row.scope)
    },
    recordLaneSamples(rows: readonly LaneMeasured[]) {
      const at = now()
      for (const l of rows)
        insertLane.run(
          at,
          l.lane,
          l.anonMiB,
          l.fileMiB,
          l.currentMiB,
          l.limitMiB,
          l.program,
        )
    },
    recordDecisions(rows: readonly DecisionMeasured[]) {
      const at = now()
      for (const d of rows) insertDecision.run(at, ...decisionRow(d))
    },
    recordEvents(rows: readonly EventMeasured[]) {
      const at = now()
      for (const e of rows) insertEvent.run(at, ...eventRow(e))
    },
    recordShellCall(call) {
      insertCall.run(
        call.startedAt,
        call.lane,
        call.program,
        call.durationMs,
        call.outcome,
      )
    },
    trim() {
      const before = now() - MEASUREMENTS_KEPT_DAYS * DAY_MS
      for (const t of trims) t.run(before)
      rungs = rungs.filter(r => r.at >= before)
    },
    recentRows(limit) {
      const decisions = recentDecisions.all(limit).flatMap(r => {
        const lately = decisionLately(r)
        return lately === null ? [] : [lately]
      })
      const events = recentEvents.all(limit).flatMap(r => {
        const event = eventFromRow(r)
        return event === null || !isNumber(r.at)
          ? []
          : [{ at: r.at, kind: "event" as const, event }]
      })
      return [...decisions, ...events, ...rungs.slice(-limit)]
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
    },
    exportRows(days) {
      const since = now() - days * DAY_MS
      return reads.flatMap(([table, read]) =>
        read.all(since).map(row => JSON.stringify({ table, ...row })),
      )
    },
  }
}

/** The same over a database of its own in memory: a store in memory's, and the tests'. */
export const memoryMachineMeasurements = (now: () => number) =>
  sqliteMachineMeasurements(new DatabaseSync(":memory:"), now)
