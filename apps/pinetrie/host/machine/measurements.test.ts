import { DatabaseSync } from "node:sqlite"
import { threadIdFor } from "@pinetrie/core"
import {
  numbersInForce,
  RUNG_BOUNDS,
  type SampleMeasured,
} from "@pinetrie/machine"
import { expect, test } from "vitest"
import {
  eventFromRow,
  MEASUREMENTS_KEPT_DAYS,
  measurementsHeading,
  memoryMachineMeasurements,
  rungChanges,
  sqliteMachineMeasurements,
} from "./measurements.ts"

const DAY = 24 * 60 * 60 * 1000
const lane = threadIdFor("t-1")
const sample: SampleMeasured = {
  rung: 2,
  someAvg10: 7,
  fullAvg10: 6,
  memoryTotal: 8,
  memoryAvailable: 1,
  source: "whole-machine",
  since: {
    refaultAnon: 1,
    refaultFile: 2,
    stallSomeUs: 3,
    stallFullUs: 4,
  },
  reclaim: { allocStalls: 5, scannedDirect: 6, scannedByKswapd: 7 },
  lanesRunning: 1,
  mode: "observe",
}

/** Every exported row, parsed. */
const rows = (lines: readonly string[]) =>
  lines.map(l => JSON.parse(l) as Record<string, unknown>)

test("each kind of row is kept in its table, stamped with the host's clock, and exported naming it", () => {
  const now = 10 * DAY
  const m = memoryMachineMeasurements(() => now)
  m.recordSample(sample)
  m.recordLaneSamples([
    {
      lane,
      anonMiB: 100,
      fileMiB: 500,
      currentMiB: 600,
      limitMiB: null,
      program: "pnpm",
    },
  ])
  m.recordShellCall({
    lane,
    program: "pnpm",
    startedAt: now - 2000,
    durationMs: 1500,
    outcome: "exited",
  })
  m.recordDecisions([
    {
      kind: "treatment",
      lane,
      from: "normal",
      to: "paused",
      fullAvg10: 12,
      memoryAvailable: 1,
    },
    {
      kind: "shadow",
      decision: { kind: "kill", lane, program: "tsc" },
      fullAvg10: 12,
      memoryAvailable: 1,
    },
  ])
  expect(rows(m.exportRows(1))).toEqual([
    expect.objectContaining({
      table: "samples",
      at: now,
      rung: 2,
      refault_file: 2,
      mode: "observe",
    }),
    expect.objectContaining({
      table: "lane-samples",
      lane,
      program: "pnpm",
      current_mib: 600,
    }),
    expect.objectContaining({
      table: "shell-calls",
      lane,
      duration_ms: 1500,
      outcome: "exited",
    }),
    expect.objectContaining({
      table: "decisions",
      kind: "treatment",
      to_treatment: "paused",
    }),
    expect.objectContaining({
      table: "decisions",
      kind: "kill",
      program: "tsc",
    }),
    {
      table: "reclaim",
      at: now,
      alloc_stalls: 5,
      scanned_direct: 6,
      scanned_by_kswapd: 7,
    },
  ])
})

test("a sample with no reclaim to compare keeps no reclaim row", () => {
  const m = memoryMachineMeasurements(() => DAY)
  m.recordSample({ ...sample, reclaim: null })
  expect(rows(m.exportRows(1)).map(r => r.table)).toEqual(["samples"])
})

test("a trim deletes the rows older than what is kept, and an export reads only its days", () => {
  let now = 0
  const m = memoryMachineMeasurements(() => now)
  m.recordSample(sample)
  now = 3 * DAY
  m.recordSample({ ...sample, rung: 3 })
  now = (MEASUREMENTS_KEPT_DAYS + 1) * DAY
  expect(
    rows(m.exportRows(MEASUREMENTS_KEPT_DAYS)).map(r => [
      r.table,
      r.rung ?? r.alloc_stalls,
    ]),
  ).toEqual([
    ["samples", 3],
    ["reclaim", 5],
  ])
  m.trim()
  now = 0
  expect(
    rows(m.exportRows(1000)).map(r => [r.table, r.rung ?? r.alloc_stalls]),
  ).toEqual([
    ["samples", 3],
    ["reclaim", 5],
  ])
})

test("each event is kept in its own table, exported, read back as it was, and trimmed", () => {
  let now = DAY
  const m = memoryMachineMeasurements(() => now)
  const events = [
    { kind: "lane-oom-killed", lane },
    { kind: "service-oom-killed", service: "observer" },
    { kind: "snapshots-deleted", count: 3, bytes: 200_000 },
    { kind: "host-stalled", ms: 1500 },
    { kind: "repair-asked-again" },
    { kind: "slow-step", where: "your repo", ms: 900 },
    { kind: "slow-step", where: null, ms: 800 },
    { kind: "slow-command", program: "jj", subcommand: "log", ms: 700 },
    { kind: "slow-command", program: "git", subcommand: null, ms: 600 },
    {
      kind: "cgroup-at-limit",
      subject: { kind: "service", service: "observer" },
      maxHits: 41,
      highHits: 0,
    },
    {
      kind: "cgroup-at-limit",
      subject: { kind: "lane", lane },
      maxHits: 3,
      highHits: 2,
    },
    {
      kind: "cgroup-at-limit",
      subject: { kind: "own" },
      maxHits: 0,
      highHits: 9,
    },
  ] as const
  m.recordEvents(events)
  const exported = rows(m.exportRows(1)).filter(r => r.table === "events")
  expect(exported.map(eventFromRow)).toEqual(events)
  now = (MEASUREMENTS_KEPT_DAYS + 2) * DAY
  m.trim()
  now = DAY
  expect(rows(m.exportRows(1000)).filter(r => r.table === "events")).toEqual([])
})

test("what happened lately is newest first across decisions, events and the rung's changes, without shadow decisions", () => {
  let now = 1000
  const m = memoryMachineMeasurements(() => now)
  m.recordSample({ ...sample, rung: 0 })
  now = 2000
  m.recordDecisions([
    {
      kind: "treatment",
      lane,
      from: "normal",
      to: "paused",
      fullAvg10: 12,
      memoryAvailable: 1,
    },
    {
      kind: "shadow",
      decision: { kind: "kill", lane, program: "tsc" },
      fullAvg10: 12,
      memoryAvailable: 1,
    },
  ])
  now = 3000
  m.recordSample({ ...sample, rung: 3 })
  now = 4000
  m.recordEvents([{ kind: "host-stalled", ms: 1200 }])
  now = 5000
  m.recordDecisions([
    {
      kind: "repair",
      from: "failed",
      to: "detected",
      fullAvg10: null,
      memoryAvailable: 1,
    },
  ])
  expect(m.recentRows(10)).toEqual([
    { at: 5000, kind: "repair", from: "failed", to: "detected" },
    { at: 4000, kind: "event", event: { kind: "host-stalled", ms: 1200 } },
    { at: 3000, kind: "rung", from: 0, to: 3 },
    { at: 2000, kind: "treatment", lane, from: "normal", to: "paused" },
  ])
  expect(m.recentRows(2).map(r => r.at)).toEqual([5000, 4000])
})

test("the rung's changes are read from the samples a store already keeps", () => {
  const db = new DatabaseSync(":memory:")
  let now = 1000
  sqliteMachineMeasurements(db, () => now).recordSample({ ...sample, rung: 1 })
  now = 2000
  const again = sqliteMachineMeasurements(db, () => now)
  again.recordSample({ ...sample, rung: 2 })
  expect(again.recentRows(5)).toEqual([
    { at: 2000, kind: "rung", from: 1, to: 2 },
  ])
})

test("the rung changes only between consecutive samples that differ", () => {
  expect(
    rungChanges([
      { at: 1, rung: 0 },
      { at: 2, rung: 0 },
      { at: 3, rung: 2 },
      { at: 4, rung: 2 },
      { at: 5, rung: 1 },
    ]),
  ).toEqual([
    { at: 3, kind: "rung", from: 0, to: 2 },
    { at: 5, kind: "rung", from: 2, to: 1 },
  ])
})

test("shadow decisions newer than what happened crowd none of it out of Lately", () => {
  let now = 1000
  const m = memoryMachineMeasurements(() => now)
  m.recordDecisions([
    {
      kind: "treatment",
      lane,
      from: "normal",
      to: "paused",
      fullAvg10: 12,
      memoryAvailable: 1,
    },
  ])
  now = 2000
  m.recordDecisions(
    Array.from({ length: 5 }, () => ({
      kind: "shadow" as const,
      decision: { kind: "kill" as const, lane, program: "tsc" },
      fullAvg10: 12,
      memoryAvailable: 1,
    })),
  )
  expect(m.recentRows(2)).toEqual([
    { at: 1000, kind: "treatment", lane, from: "normal", to: "paused" },
  ])
})

test("the export's first line names the numbers in force, as their modules have them", () => {
  const numbers = numbersInForce({
    sampleEveryMs: 5000,
    readingOverdueAfterTicks: 6,
    memoryLimits: null,
  })
  const heading = JSON.parse(
    measurementsHeading(
      {
        version: "0.1.0",
        backend: "lane-vm",
        source: "whole-machine",
        numbers,
      },
      7,
    ),
  ) as Record<string, unknown>
  expect(heading).toEqual({
    version: "0.1.0",
    backend: "lane-vm",
    source: "whole-machine",
    numbers: JSON.parse(JSON.stringify(numbers)),
    days: 7,
  })
  expect((heading.numbers as Record<string, unknown>).RUNG_BOUNDS).toEqual(
    RUNG_BOUNDS,
  )
})
