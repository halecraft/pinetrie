import { BASE_SNAPSHOT, snapshotId, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { argvs, LANE, spec } from "./fixtures.ts"
import type { InnerDockerDataRootSource } from "./nested-data-root.ts"
import { planShape } from "./shape.ts"
import { baseLane, type LaneSpec } from "./spec.ts"
import { planDiskThenStart, planSnapshot, planStart } from "./steps.ts"

const KEEP: InnerDockerDataRootSource = { kind: "keep" }
const nested: LaneSpec = { ...spec, grants: { ...spec.grants, nested: true } }

test("planDiskThenStart: a new disk, or one restored from a snapshot; then the container, from the spec's shape", () => {
  const disk = (from: typeof BASE_SNAPSHOT | null) =>
    planDiskThenStart({ spec, env: {}, from, dataRoot: KEEP })
  expect(disk(null)).toEqual([
    { in: "runtime", op: { kind: "create", lane: LANE } },
    {
      in: "runtime",
      op: { kind: "run", start: { shape: planShape(spec, {}) } },
    },
  ])
  expect(disk(BASE_SNAPSHOT)[0]).toEqual({
    in: "runtime",
    op: { kind: "restore", lane: LANE, from: BASE_SNAPSHOT },
  })
})

test("only a nested lane's start makes its data root", () => {
  const other = threadIdFor("2")
  const clone: InnerDockerDataRootSource = {
    kind: "clone",
    cloneFromLane: other,
    atRunEnd: 3,
  }
  expect(argvs(planStart(spec, {}, clone))).toEqual([
    `runtime: run pinetrie-${LANE}`,
  ])
  expect(argvs(planStart(nested, {}, clone))).toEqual([
    `runtime: ${JSON.stringify({ kind: "inner-docker-data-root", lane: LANE, cloneFromLane: other })}`,
    `runtime: run pinetrie-${LANE}`,
  ])
})

test("planStart: a folder lane makes its states directory, then its container", () => {
  expect(argvs(planStart({ ...nested, states: true }, {}, KEEP))).toEqual([
    `runtime: ${JSON.stringify({ kind: "inner-docker-data-root", lane: LANE, cloneFromLane: null })}`,
    `runtime: ${JSON.stringify({ kind: "states-dir", lane: LANE })}`,
    `runtime: run pinetrie-${LANE}`,
  ])
})

test("planDiskThenStart: a nested base's scratch lane makes its own data root before its container", () => {
  const BASE_LANE = baseLane("0123456789abcdef")
  const steps = planDiskThenStart({
    spec: { ...nested, lane: BASE_LANE },
    env: {},
    from: null,
    dataRoot: KEEP,
  })
  expect(argvs(steps)).toEqual([
    `runtime: ${JSON.stringify({ kind: "create", lane: BASE_LANE })}`,
    `runtime: ${JSON.stringify({ kind: "inner-docker-data-root", lane: BASE_LANE, cloneFromLane: null })}`,
    `runtime: run pinetrie-${BASE_LANE}`,
  ])
})

test("planSnapshot: sync comes before the snapshot", () => {
  expect(planSnapshot({ lane: LANE, snapshot: snapshotId("e2") })).toEqual([
    { in: "lane", argv: ["sync"] },
    {
      in: "runtime",
      op: { kind: "snapshot", lane: LANE, snapshot: snapshotId("e2") },
    },
  ])
})
