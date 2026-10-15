import { pointId, type StateRecord, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planFolderRecords } from "./offers.ts"

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
const STATES = [
  state("line-0", { kind: "read" }),
  state("start-a", { kind: "start", lane: LANE }, "line-0"),
  state("line-1", { kind: "read" }, "line-0"),
]
const plan = (before: Parameters<typeof planFolderRecords>[0]["before"]) =>
  planFolderRecords({
    lane: LANE,
    states: STATES,
    files: ["a.txt"],
    brings: ["b.txt"],
    worked: true,
    conflicts: [],
    before,
    now: 2,
  })

test("planFolderRecords: the offer against your folder's newest, the base on what the lane holds, with what catching up brings", () => {
  expect(plan(undefined)).toEqual({
    offer: {
      kind: "folder",
      lane: LANE,
      start: "line-1",
      tip: "start-a",
      files: ["a.txt"],
      conflicts: [],
      description: null,
      at: 2,
    },
    base: {
      kind: "folder",
      lane: LANE,
      start: "line-0",
      catchUp: { tip: "start-a", to: "line-1", files: ["b.txt"] },
      work: "some",
    },
  })
})

test("planFolderRecords: a description holds while it describes the same two states, and goes when either moves", () => {
  const described = {
    kind: "folder",
    lane: LANE,
    start: pointId("line-1"),
    tip: pointId("start-a"),
    files: ["a.txt"],
    conflicts: [],
    description: "add a",
    at: 1,
  } as const
  expect(plan(described)?.offer.description).toBe("add a")
  expect(
    plan({ ...described, start: pointId("line-0") })?.offer.description,
  ).toBeNull()
})
