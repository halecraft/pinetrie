import type { BaseMerge, CopyFacts, SnapshotId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { refreshBase } from "./base.ts"
import {
  type BaseCheckout,
  baseCheckout,
  type ForkSetup,
  forkSetup,
  type LaneHistory,
} from "./history-port.ts"
import { type LaneSpec, planFork } from "./plan.ts"

test("a merge takes only a copy found ready, never its facts", () => {
  const merge = (h: LaneHistory, facts: CopyFacts, from: BaseMerge) =>
    // @ts-expect-error: only `planCopyReady` makes a `ReadyCopy`
    h.merge(facts, from, null)
  expect(merge).toBeTypeOf("function")
})

test("a fork takes only a fork's setup, and the base only a checkout", () => {
  const fork = (spec: LaneSpec, snapshot: SnapshotId, base: BaseCheckout) =>
    planFork({
      point: { snapshot },
      spec,
      env: {},
      // @ts-expect-error: a base's checkout is no fork's setup
      setup: base,
    })
  const refresh = (
    input: Omit<Parameters<typeof refreshBase>[0], "checkout">,
    setup: ForkSetup,
  ) =>
    // @ts-expect-error: a fork's setup is no base's checkout
    refreshBase({ ...input, checkout: () => setup })
  expect([fork, refresh]).toHaveLength(2)
  expect(forkSetup([]).steps).toEqual(baseCheckout([]).steps)
})
