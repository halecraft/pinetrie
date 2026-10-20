import {
  type ConflictRecord,
  entryId,
  type PathFact,
  type PointId,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { planResolve } from "./resolve.ts"

const LANE = threadIdFor("1")
const record = (
  id: string,
  made: StateRecord["made"],
  ...parents: string[]
): StateRecord => ({
  id: pointId(id),
  parents: parents.map(pointId),
  made,
  at: 0,
  by: null,
})
const states = [
  record("line-1", { kind: "read" }),
  record("start-1", { kind: "start", lane: LANE }, "line-1"),
  record(
    "turn-1",
    { kind: "turn", lane: LANE, entry: entryId("e-1") },
    "start-1",
  ),
  record("line-2", { kind: "read" }, "line-1"),
  record("catch-up-1", { kind: "get-latest", lane: LANE }, "turn-1", "line-2"),
]
const open: ConflictRecord = {
  lane: LANE,
  path: "a.txt",
  base: pointId("line-1"),
  ours: pointId("turn-1"),
  theirs: pointId("line-2"),
}
const FILE: PathFact = { kind: "file", exec: false, content: "text", size: 3 }
const resolve = (over: Partial<Parameters<typeof planResolve>[0]> = {}) =>
  planResolve({
    states,
    lane: LANE,
    path: "a.txt",
    open,
    choose: "theirs",
    chosen: FILE,
    id: pointId("resolve-1") as PointId,
    at: 1,
    by: null,
    ...over,
  })

test("planResolve: ours takes no step, and records a resolve on the lane's newest, the conflict closed", () => {
  const record = {
    id: "resolve-1",
    parents: ["catch-up-1"],
    made: { kind: "resolve", lane: LANE, path: "a.txt" },
    at: 1,
    by: null,
  }
  expect(resolve({ choose: "ours", chosen: null })).toEqual({
    kind: "resolve",
    step: null,
    record,
    records: {
      states: [record],
      conflicts: [],
      closed: [{ lane: LANE, path: "a.txt" }],
    },
  })
})

test("planResolve: a chosen side holding the file takes it; one holding none deletes it", () => {
  const take = resolve()
  expect(take.kind === "resolve" ? take.step : null).toEqual({
    kind: "take",
    path: "a.txt",
  })
  const gone = resolve({ choose: "base", chosen: { kind: "absent" } })
  expect(gone.kind === "resolve" ? gone.step : null).toEqual({
    kind: "delete",
    path: "a.txt",
  })
})

test("planResolve: a path with no open conflict closes nothing", () => {
  expect(resolve({ open: undefined })).toEqual({ kind: "no-conflict" })
})
