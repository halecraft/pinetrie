import { pointId, type StateRecord, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { shownMergeId } from "./graph.ts"
import { planFolderRecords, planShownMerge } from "./proposed.ts"

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

test("planFolderRecords: the proposed changes against accepted work's newest, the base on what the lane holds, with what catching up brings", () => {
  expect(plan(undefined)).toEqual({
    proposed: {
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
      getLatest: { tip: "start-a", to: "line-1", files: ["b.txt"] },
      work: "some",
    },
    drop: null,
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
  expect(plan(described)?.proposed.description).toBe("add a")
  expect(
    plan({ ...described, start: pointId("line-0") })?.proposed.description,
  ).toBeNull()
})

test("planFolderRecords: the shown merge a new record replaces is dropped, unless an accept made it a state", () => {
  const before = {
    kind: "folder",
    lane: LANE,
    start: pointId("line-0"),
    tip: pointId("start-a"),
    files: ["a.txt"],
    conflicts: [],
    description: null,
    at: 1,
  } as const
  const was = shownMergeId(before.start, before.tip)
  expect(plan(before)?.drop).toBe(was)
  const shown = { ...before, start: pointId("line-1") }
  const accepted = shownMergeId(shown.start, shown.tip)
  expect(
    planFolderRecords({
      lane: LANE,
      states: [
        ...STATES,
        state(accepted, { kind: "accept", lane: LANE }, "line-1", "start-a"),
      ],
      files: [],
      brings: [],
      worked: false,
      conflicts: [],
      before: shown,
      now: 2,
    })?.drop,
  ).toBeNull()
})

test("planShownMerge: a lane not begun has none to show; one accepted work holds already shows accepted work's newest", () => {
  expect(planShownMerge(STATES, threadIdFor("2"))).toEqual({
    kind: "withdraw",
  })
  expect(planShownMerge(STATES, LANE)).toEqual({
    kind: "build",
    newest: "line-1",
    tip: "start-a",
    start: "line-0",
    holds: false,
    shown: shownMergeId(pointId("line-1"), pointId("start-a")),
  })
  const accepted = [
    ...STATES,
    state("line-2", { kind: "accept", lane: LANE }, "line-1", "start-a"),
  ]
  expect(planShownMerge(accepted, LANE)).toMatchObject({
    holds: true,
    shown: "line-2",
  })
})
