import {
  entryId,
  type PointId,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { planKeep } from "./sweep.ts"

const LANE = threadIdFor("1")
const state = (
  id: string,
  made: StateRecord["made"],
  ...parents: string[]
): StateRecord => ({
  id: pointId(id),
  parents: parents.map(pointId),
  made,
  at: 1,
  by: null,
})
const every = (states: readonly StateRecord[]): ReadonlySet<PointId> =>
  new Set(states.map(s => s.id))
const keep = (
  states: readonly StateRecord[],
  more: Partial<Parameters<typeof planKeep>[0]> = {},
) =>
  planKeep({
    states,
    lanes: [{ lane: LANE, history: "folder" }],
    conflicts: [],
    proposed: [],
    journals: [],
    keep: 1,
    exists: every(states),
    ...more,
  })

test("planKeep: a lane's tip and start, and accepted work's newest states kept; older ones and a lane's past turns swept", () => {
  const states = [
    state("line-0", { kind: "read" }),
    state("line-1", { kind: "read" }, "line-0"),
    state("start-a", { kind: "start", lane: LANE }, "line-1"),
    state(
      "turn-a",
      { kind: "turn", lane: LANE, entry: entryId("e") },
      "start-a",
    ),
    state(
      "turn-b",
      { kind: "turn", lane: LANE, entry: entryId("f") },
      "turn-a",
    ),
    state("line-2", { kind: "read" }, "line-1"),
  ]
  expect(keep(states).gone).toEqual(["line-0", "start-a", "turn-a"])
})

test("planKeep: a branch's base with its parent kept, once the parent moved past it", () => {
  const BRANCH = threadIdFor("2")
  const states = [
    state("line-1", { kind: "read" }),
    state("start-a", { kind: "start", lane: LANE }, "line-1"),
    state(
      "turn-a",
      { kind: "turn", lane: LANE, entry: entryId("e") },
      "start-a",
    ),
    state(
      "turn-b",
      { kind: "turn", lane: LANE, entry: entryId("f") },
      "turn-a",
    ),
    state("start-b", { kind: "start", lane: BRANCH }, "turn-a"),
  ]
  expect(
    keep(states, { lanes: [{ lane: BRANCH, history: "folder" }] }).gone,
  ).toEqual(["start-a", "turn-b"])
})

test("planKeep: a state whose snapshot is gone already is not swept again", () => {
  const states = [
    state("line-0", { kind: "read" }),
    state("line-1", { kind: "read" }, "line-0"),
  ]
  expect(
    keep(states, { lanes: [], exists: new Set([pointId("line-1")]) }).gone,
  ).toEqual([])
})

test("planKeep: kept is accepted work's line kept, newest first, a concurrent save before the accept it was made on", () => {
  const states = [
    state("line-0", { kind: "read" }),
    state("start-a", { kind: "start", lane: LANE }, "line-0"),
    state("shown-a", { kind: "accept", lane: LANE }, "line-0", "start-a"),
    state("concurrent-a", { kind: "concurrent", path: "a.txt" }, "shown-a"),
    state("line-1", { kind: "read" }, "shown-a"),
  ]
  const planned = keep(states, { lanes: [], keep: 3 })
  expect(planned.kept).toEqual(["line-1", "concurrent-a", "shown-a", "line-0"])
  expect(planned.newest).toBe("line-1")
})

test("planKeep: kept names no state whose snapshot is gone, nor one swept", () => {
  const states = [
    state("line-0", { kind: "read" }),
    state("line-1", { kind: "read" }, "line-0"),
    state("line-2", { kind: "read" }, "line-1"),
    state("line-3", { kind: "read" }, "line-2"),
  ]
  const planned = keep(states, {
    lanes: [],
    keep: 3,
    exists: new Set(["line-0", "line-2", "line-3"].map(pointId)),
  })
  expect(planned.kept).toEqual(["line-3", "line-2"])
  expect(planned.gone).toEqual(["line-0"])
})
