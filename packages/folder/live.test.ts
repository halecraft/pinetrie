import {
  entryId,
  type PointId,
  pointId,
  type StateMade,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { stateGraph } from "./graph.ts"
import { type LiveInput, liveStates } from "./live.ts"

const LANE = threadIdFor("1")
const p = pointId

const record = (
  id: string,
  made: StateMade,
  ...parents: string[]
): StateRecord => ({
  id: p(id),
  parents: parents.map(p),
  made,
  at: 0,
  by: null,
})

// Your folder's line: line-1 .. line-4; a lane begun on line-1, its turn
// t-1, then t-2; line-3 accepts t-1.
const graph = stateGraph([
  record("line-1", { kind: "read" }),
  record("s-1", { kind: "start", lane: LANE }, "line-1"),
  record("t-1", { kind: "turn", lane: LANE, entry: entryId("e-1") }, "s-1"),
  record("t-2", { kind: "turn", lane: LANE, entry: entryId("e-2") }, "t-1"),
  record("line-2", { kind: "read" }, "line-1"),
  record("line-3", { kind: "accept", lane: LANE }, "line-2", "t-1"),
  record("line-4", { kind: "read" }, "line-3"),
  record("bases-1", { kind: "bases-merged" }, "line-2", "t-1"),
])

const input = (over: Partial<LiveInput>): LiveInput => ({
  graph,
  lanes: [],
  conflicts: [],
  offers: [],
  folderNewest: p("line-4"),
  keep: 1,
  ...over,
})

const ids = (s: ReadonlySet<PointId>) => [...s].sort()

describe("liveStates", () => {
  test("a foreign folder lane's tip, start and base with your folder are kept", () => {
    const live = liveStates(
      input({
        lanes: [{ history: "folder", tip: p("t-2"), start: p("s-1") }],
      }),
    )
    expect(ids(live)).toEqual(["line-4", "s-1", "t-1", "t-2"])
  })

  test("a jj lane's points are no states of the graph, and keep nothing", () => {
    const live = liveStates(
      input({ lanes: [{ history: "jj", tip: p("c1"), start: p("c0") }] }),
    )
    expect(ids(live)).toEqual(["line-4"])
  })

  test("keep drops the oldest line states no other member needs", () => {
    expect(ids(liveStates(input({ keep: 2 })))).toEqual(["line-3", "line-4"])
    expect(ids(liveStates(input({ keep: 0 })))).toEqual(["line-4"])
    expect(
      ids(
        liveStates(
          input({ keep: 2, offers: [{ start: p("line-1"), tip: p("t-1") }] }),
        ),
      ),
    ).toEqual(["line-1", "line-3", "line-4", "t-1"])
  })

  test("a virtual base is kept while a conflict names it, and not otherwise", () => {
    const conflict = { base: p("bases-1"), ours: p("t-1"), theirs: p("line-4") }
    expect(liveStates(input({ conflicts: [conflict] })).has(p("bases-1"))).toBe(
      true,
    )
    expect(liveStates(input({})).has(p("bases-1"))).toBe(false)
  })
})
