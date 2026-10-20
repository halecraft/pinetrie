import {
  type BasePlan,
  entryId,
  type PointId,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { virtualBaseName } from "./graph.ts"
import { planGetLatestRecords, planStateRecords } from "./records.ts"

const LANE = threadIdFor("1")
const state = (
  id: string,
  made: StateRecord["made"],
  ...parents: PointId[]
): StateRecord => ({ id: pointId(id), parents, made, at: 1, by: null })
const L0 = state("line-0", { kind: "read" })
const S = state("start-1", { kind: "start", lane: LANE }, L0.id)
const T = state(
  "turn-1",
  { kind: "turn", lane: LANE, entry: entryId("e") },
  S.id,
)
const L1 = state("line-1", { kind: "read" }, L0.id)
const RECORDS = [L0, S, T, L1]

test("planStateRecords: a new state is recorded, one recorded with the same parents is not, and a refused one throws", () => {
  const turn = state(
    "turn-2",
    { kind: "turn", lane: LANE, entry: entryId("f") },
    T.id,
  )
  expect(planStateRecords(RECORDS, turn).states).toEqual([turn])
  expect(planStateRecords(RECORDS, T).states).toEqual([])
  expect(() =>
    planStateRecords(RECORDS, { ...turn, parents: [pointId("line-9")] }),
  ).toThrow()
})

test("planGetLatestRecords: the merge's state on both sides, a conflict per path, and a virtual base's state only when a conflict names it", () => {
  const virtual: BasePlan = {
    kind: "virtual",
    name: virtualBaseName([L0.id, S.id]),
    first: L0.id,
    merges: [{ base: { kind: "state", state: L0.id }, other: S.id }],
  }
  const records = (paths: readonly string[], plan: BasePlan) =>
    planGetLatestRecords({
      states: RECORDS,
      lane: LANE,
      state: pointId("catch-up-1"),
      ours: T.id,
      theirs: L1.id,
      plan,
      base: plan.kind === "virtual" ? plan.name : plan.state,
      paths,
      at: 2,
    })
  const clean = records([], virtual)
  expect(clean.states.map(r => r.id)).toEqual(["catch-up-1"])
  expect(clean.states[0]?.parents).toEqual([T.id, L1.id])
  expect(clean.conflicts).toEqual([])
  const conflicted = records(["a.txt"], virtual)
  expect(conflicted.states.map(r => r.id)).toEqual([virtual.name, "catch-up-1"])
  expect(conflicted.conflicts).toEqual([
    {
      lane: LANE,
      path: "a.txt",
      base: virtual.name,
      ours: T.id,
      theirs: L1.id,
    },
  ])
  expect(
    records(["a.txt"], { kind: "state", state: L0.id }).states.map(r => r.id),
  ).toEqual(["catch-up-1"])
})
