import { snapshotId, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { spec } from "./fixtures.ts"
import { planFork } from "./fork.ts"
import { forkSetup } from "./history-port.ts"
import { baseLane, containerLane, laneContainer } from "./spec.ts"

const KEY = "0123456789abcdef"

test("the base's scratch lane is no thread's: nothing that takes a thread takes it", () => {
  const setup = planFork({
    source: { snapshot: snapshotId("e1") },
    // @ts-expect-error: a fork is a thread's lane's
    spec: { ...spec, lane: baseLane(KEY) },
    env: {},
    setup: forkSetup(null, []),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect(setup.steps).toHaveLength(5)
})

test("each project's base is made in a container of its own, named by its key", () => {
  const other = "fedcba9876543210"
  expect([
    laneContainer(baseLane(KEY)),
    laneContainer(baseLane(other)),
    laneContainer(baseLane(KEY)),
  ]).toEqual([
    `pinetrie-base-scratch-${KEY}`,
    `pinetrie-base-scratch-${other}`,
    `pinetrie-base-scratch-${KEY}`,
  ])
})

test("a lane's container names its thread back; no other container names one", () => {
  const thread = threadIdFor("0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e6f")
  expect(containerLane(laneContainer(thread))).toBe(thread)
  expect(containerLane(laneContainer(baseLane(KEY)))).toBeNull()
  expect(containerLane(`pinetrie-lanehost-disks-${KEY}`)).toBeNull()
  expect(containerLane("pinetrie-observer-1")).toBeNull()
})
