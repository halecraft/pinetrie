import { describe, expect, test } from "vitest"
import {
  entryId,
  isDiskName,
  isFolderStateId,
  isLineState,
  lineStateId,
  lineStates,
  pointId,
  type StateMade,
  type StateRecord,
  stateLane,
  type ThreadId,
  threadIdFor,
  turnStateId,
  writeContent,
} from "./index.ts"

describe("folder state ids", () => {
  test("a turn's state, a line state and a virtual base are state ids", () => {
    expect(
      isFolderStateId(turnStateId("01a14df0-0000-7000-8000-000000000001")),
    ).toBe(true)
    expect(
      isFolderStateId(lineStateId("01a14df0-0000-7000-8000-00000000000a")),
    ).toBe(true)
    expect(isFolderStateId("bases-0123abcd")).toBe(true)
  })

  test("a jj commit's id is never one", () => {
    expect(isFolderStateId("0123456789abcdef0123456789abcdef01234567")).toBe(
      false,
    )
  })

  test("an id with no dash is never one, nor one no disk can be named", () => {
    expect(isFolderStateId("base")).toBe(false)
    expect(isFolderStateId("a-b/c")).toBe(false)
    expect(isFolderStateId("line-1.tmp")).toBe(false)
  })

  test("a disk's name is one segment that never ends in .tmp", () => {
    for (const ok of ["base", "t-1", "a.b_c-d"])
      expect(isDiskName(ok)).toBe(true)
    for (const bad of ["", ".", "..", "a/b", "-a", "x.tmp"])
      expect(isDiskName(bad)).toBe(false)
  })
})

const LANE = threadIdFor("1")
const state = (
  id: string,
  made: StateMade,
  ...parents: string[]
): StateRecord => ({
  id: pointId(id),
  parents: parents.map(pointId),
  made,
  at: 1,
  by: null,
})

describe("states and accepted work's line", () => {
  const every: readonly [StateMade, boolean, ThreadId | null][] = [
    [{ kind: "read" }, true, null],
    [{ kind: "start", lane: LANE }, false, LANE],
    [{ kind: "turn", lane: LANE, entry: entryId("e") }, false, LANE],
    [{ kind: "catch-up", lane: LANE }, false, LANE],
    [{ kind: "accept", lane: LANE }, true, null],
    [{ kind: "restore", of: pointId("line-0") }, true, null],
    [{ kind: "resolve", lane: LANE, path: "a.txt" }, false, LANE],
    [{ kind: "bases-merged" }, false, null],
    [{ kind: "concurrent", path: "a.txt" }, false, null],
  ]

  test("isLineState and stateLane over every way a state is made", () => {
    for (const [made, line, lane] of every) {
      const r = state("s-1", made)
      expect([made.kind, isLineState(r), stateLane(r)]).toEqual([
        made.kind,
        line,
        lane,
      ])
    }
  })

  test("lineStates walks first parents from the newest, ending at the first read", () => {
    const states = [
      state("line-0", { kind: "read" }),
      state("start-a", { kind: "start", lane: LANE }, "line-0"),
      state("shown-a", { kind: "accept", lane: LANE }, "line-0", "start-a"),
      state("restore-a", { kind: "restore", of: pointId("line-0") }, "shown-a"),
    ]
    const graph = new Map(states.map(s => [s.id, s]))
    expect(lineStates(graph, pointId("restore-a")).map(s => s.id)).toEqual([
      "restore-a",
      "shown-a",
      "line-0",
    ])
  })

  test("lineStates from a lane's state is empty: it is no line state", () => {
    const states = [
      state("line-0", { kind: "read" }),
      state("start-a", { kind: "start", lane: LANE }, "line-0"),
    ]
    const graph = new Map(states.map(s => [s.id, s]))
    expect(lineStates(graph, pointId("start-a"))).toEqual([])
  })

  test("writeContent: an accept writes its own snapshot, a restore the state it restores", () => {
    expect(
      writeContent(
        state("shown-a", { kind: "accept", lane: LANE }, "line-0", "start-a"),
      ),
    ).toBe("shown-a")
    expect(
      writeContent(
        state(
          "restore-a",
          { kind: "restore", of: pointId("line-0") },
          "line-1",
        ),
      ),
    ).toBe("line-0")
  })
})
