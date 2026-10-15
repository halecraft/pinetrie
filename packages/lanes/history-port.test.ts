import {
  type BaseMerge,
  type CopyFacts,
  pointId,
  type SnapshotId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { refreshBase } from "./base.ts"
import {
  type BaseCheckout,
  baseCheckout,
  type ForkSetup,
  forkSetup,
  type LaneHistory,
} from "./history-port.ts"
import { type LaneOwner, type LaneSpec, planFork } from "./plan.ts"
import type { LaneRuntime } from "./runtime-port.ts"

test("a merge takes only a copy found ready, never its facts", () => {
  const merge = (h: LaneHistory, facts: CopyFacts, from: BaseMerge) =>
    // @ts-expect-error: only `planCopyReady` makes a `ReadyCopy`
    h.merge(facts, from, null)
  expect(merge).toBeTypeOf("function")
})

test("refreshBase does nothing for accepted work with no checkout", async () => {
  const untouched = new Proxy({} as LaneRuntime, {
    get: (_, call) => () => {
      throw new Error(`the runtime was asked: ${String(call)}`)
    },
  })
  const made = await refreshBase({
    runtime: untouched,
    spec: {} as LaneSpec<LaneOwner>,
    env: {},
    open: () => Promise.reject(new Error("no lane")),
    accepted: { points: [pointId("line-1")], checkout: null },
  })
  expect(made).toBe(false)
})

test("a fork takes only a fork's setup, and the base only a checkout", () => {
  const fork = (spec: LaneSpec, snapshot: SnapshotId, base: BaseCheckout) =>
    planFork({
      source: { snapshot },
      spec,
      env: {},
      // @ts-expect-error: a base's checkout is no fork's setup
      setup: base,
    })
  const refresh = (
    input: Omit<Parameters<typeof refreshBase>[0], "accepted">,
    setup: ForkSetup,
  ) =>
    // @ts-expect-error: a fork's setup is no base's checkout
    refreshBase({ ...input, accepted: { points: [], checkout: () => setup } })
  expect([fork, refresh]).toHaveLength(2)
  expect(forkSetup(null, []).steps).toEqual(baseCheckout([]).steps)
})
