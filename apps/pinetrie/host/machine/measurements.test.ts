import { threadIdFor } from "@pinetrie/core"
import type { SampleMeasured } from "@pinetrie/machine"
import { expect, test } from "vitest"
import {
  MEASUREMENTS_KEPT_DAYS,
  memoryMachineMeasurements,
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
  ])
})

test("a trim deletes the rows older than what is kept, and an export reads only its days", () => {
  let now = 0
  const m = memoryMachineMeasurements(() => now)
  m.recordSample(sample)
  now = 3 * DAY
  m.recordSample({ ...sample, rung: 3 })
  now = (MEASUREMENTS_KEPT_DAYS + 1) * DAY
  expect(rows(m.exportRows(MEASUREMENTS_KEPT_DAYS)).map(r => r.rung)).toEqual([
    3,
  ])
  m.trim()
  now = 0
  expect(rows(m.exportRows(1000)).map(r => r.rung)).toEqual([3])
})
