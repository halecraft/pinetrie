// host/machine/measurements — the machine's measurements in four tables
// beside the documents' in the session's file, on the store's connection, as
// the snapshot index's are: each row stamped with the host's clock, kept for
// `MEASUREMENTS_KEPT_DAYS`, and exported as JSON lines. No planner reads the
// time: it is for tuning the memory rungs later, from what was kept.

import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type {
  DecisionMeasured,
  LaneMeasured,
  MachineMeasurements,
  SampleMeasured,
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
} as const

export interface HostMeasurements extends MachineMeasurements {
  /** A `bash` call ended: its lane, program, start and duration. */
  recordShellCall(call: ShellCallEnded): void
  /** Every row of the last `days` days, each a JSON line naming its table, oldest first within each. */
  exportRows(days: number): readonly string[]
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
    const s = d.decision
    return s.kind === "kill"
      ? [s.kind, s.lane, null, null, null, s.program, ...at]
      : [s.kind, s.lane, null, null, s.wouldFreeBytes, null, ...at]
  }

  return {
    recordSample(row: SampleMeasured) {
      const { since } = row
      insertSample.run(
        now(),
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
