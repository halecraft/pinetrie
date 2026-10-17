import {
  type ConflictRecord,
  pointId,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { conflictsView } from "./conflicts-view.ts"

const LANE = threadIdFor("1")
const PARENT = threadIdFor("2")
const state = (id: string, made: StateRecord["made"]): StateRecord => ({
  id: pointId(id),
  parents: [],
  made,
  at: 0,
  by: null,
})
const states = new Map(
  [
    state("line-1", { kind: "read" }),
    state("line-2", { kind: "read" }),
    state("turn-p", { kind: "turn", lane: PARENT, entry: "e" as never }),
  ].map(s => [s.id, s]),
)
const conflict = (path: string, theirs: string): ConflictRecord => ({
  lane: LANE,
  path,
  base: pointId("line-1"),
  ours: pointId("turn-1"),
  theirs: pointId(theirs),
})
const view = (conflicts: ConflictRecord[]) =>
  conflictsView({
    lane: LANE,
    conflicts,
    states,
    laneName: () => "amber-fox",
  })

test("conflictsView: theirs from accepted work is worded as accepted work's; each side its span from the base", () => {
  const [shown] = view([conflict("a.txt", "line-2")])
  expect(shown?.choices.map(c => c.label)).toEqual([
    "keep this thread's",
    "take accepted work's",
    "take the version both began from",
  ])
  expect(shown?.sides.map(s => [s.label, s.span])).toEqual([
    [
      "this thread's changes",
      { kind: "range", from: pointId("line-1"), to: pointId("turn-1") },
    ],
    [
      "accepted work's changes",
      { kind: "range", from: pointId("line-1"), to: pointId("line-2") },
    ],
  ])
})

test("conflictsView: theirs from a parent lane names that thread", () => {
  const [shown] = view([conflict("a.txt", "turn-p")])
  expect(shown?.choices[1]?.label).toBe("take amber-fox's")
  expect(shown?.sides[1].label).toBe("amber-fox's changes")
})
