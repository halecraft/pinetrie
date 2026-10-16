import { entryId, pointId, type StateRecord, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planSweep } from "./sweep.ts"

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

test("planSweep: a lane's tip and start, and accepted work's newest states kept; older ones and a lane's past turns swept", () => {
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
  expect(
    planSweep({
      states,
      lanes: [{ lane: LANE, history: "folder" }],
      conflicts: [],
      proposed: [],
      keep: 1,
    }),
  ).toEqual(["line-0", "start-a", "turn-a"])
})

test("planSweep: a branch's base with its parent kept, once the parent moved past it", () => {
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
    planSweep({
      states,
      lanes: [{ lane: BRANCH, history: "folder" }],
      conflicts: [],
      proposed: [],
      keep: 1,
    }),
  ).toEqual(["start-a", "turn-b"])
})
