import { snapshotId, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { argvs, LANE, spec } from "./fixtures.ts"
import { planFork } from "./fork.ts"
import { forkSetup } from "./history-port.ts"
import type { LaneSpec } from "./spec.ts"

test("planFork: the container and disk deleted, the restore, the container, the old config folder gone, then the adapter's setup", () => {
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec,
    env: {},
    setup: forkSetup(null, [{ in: "lane", argv: ["setup"] }]),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect(argvs(steps)).toEqual([
    `runtime: ${JSON.stringify({ kind: "remove", container: `pinetrie-${LANE}` })}`,
    `runtime: ${JSON.stringify({ kind: "delete", lane: LANE })}`,
    `runtime: ${JSON.stringify({ kind: "restore", lane: LANE, from: "e1" })}`,
    `runtime: run pinetrie-${LANE}`,
    "lane: sh -c rm -rf /workspace/.pineta-lane",
    "lane: setup",
  ])
})

test("planFork: a nested lane's data root is made after the delete and before the container runs", () => {
  const nested: LaneSpec = { ...spec, grants: { ...spec.grants, nested: true } }
  const other = threadIdFor("2")
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec: nested,
    env: {},
    setup: forkSetup(null, []),
    innerDockerDataRoot: { kind: "clone", cloneFromLane: other, atRunEnd: 3 },
  })
  expect(argvs(steps).slice(0, 5)).toEqual([
    `runtime: ${JSON.stringify({ kind: "remove", container: `pinetrie-${LANE}` })}`,
    `runtime: ${JSON.stringify({ kind: "delete", lane: LANE })}`,
    `runtime: ${JSON.stringify({ kind: "restore", lane: LANE, from: "e1" })}`,
    `runtime: ${JSON.stringify({ kind: "inner-docker-data-root", lane: LANE, cloneFromLane: other })}`,
    `runtime: run pinetrie-${LANE}`,
  ])
})

test("planFork: only a nested lane's fork says what its data root was made from", () => {
  const clone = {
    kind: "clone",
    cloneFromLane: threadIdFor("2"),
    atRunEnd: 3,
  } as const
  const fork = (s: LaneSpec) =>
    planFork({
      source: { snapshot: snapshotId("e1") },
      spec: s,
      env: {},
      setup: forkSetup(null, []),
      innerDockerDataRoot: clone,
    })
  expect(fork(spec).dataRoot).toBeNull()
  expect(
    fork({ ...spec, grants: { ...spec.grants, nested: true } }).dataRoot,
  ).toEqual(clone)
})

test("planFork restores from the adapter's snapshot when it names one", () => {
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec,
    env: {},
    setup: forkSetup(snapshotId("line-1"), []),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect(steps[2]).toEqual({
    in: "runtime",
    op: { kind: "restore", lane: LANE, from: "line-1" },
  })
})
