import { snapshotId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { spec } from "./fixtures.ts"
import { planFork } from "./fork.ts"
import { forkSetup } from "./history-port.ts"
import { BASE_LANE, laneContainer } from "./spec.ts"

test("the base's scratch lane is no thread's: nothing that takes a thread takes it", () => {
  const setup = planFork({
    source: { snapshot: snapshotId("e1") },
    // @ts-expect-error: a fork is a thread's lane's
    spec: { ...spec, lane: BASE_LANE },
    env: {},
    setup: forkSetup(null, []),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect([laneContainer(BASE_LANE), setup.steps.length]).toEqual([
    "pinetrie-base-scratch",
    5,
  ])
})
