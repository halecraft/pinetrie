import {
  type PointId,
  pointId,
  type StateRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { FolderAcceptedRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { whenWords } from "./counts.ts"
import { historyView, madeWords } from "./history-view.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const state = (
  id: string,
  made: StateRecord["made"],
  at: number,
  ...parents: string[]
): StateRecord => ({
  id: pointId(id),
  parents: parents.map(pointId),
  made,
  at,
  by: made.kind === "read" ? null : ADA,
})
const STATES = [
  state("line-0", { kind: "read" }, 1),
  state("start-a", { kind: "start", lane: LANE }, 2, "line-0"),
  state("line-1", { kind: "read" }, 3, "line-0"),
  state("shown-a", { kind: "accept", lane: LANE }, 4, "line-1", "start-a"),
  state("concurrent-a", { kind: "concurrent", path: "a.txt" }, 5, "shown-a"),
  state("restore-a", { kind: "restore", of: pointId("line-1") }, 6, "shown-a"),
]
const states = new Map(STATES.map(s => [s.id, s]))
const accepted = (kept: string[]): FolderAcceptedRecord => ({
  kind: "folder",
  newest: pointId("restore-a"),
  kept: kept.map(pointId),
  at: 6,
})
const view = (kept: string[]) =>
  historyView({
    states,
    accepted: accepted(kept),
    personName: () => "Ada",
    laneName: () => "amber-fox",
  })
const range = (from: string, to: string) => ({
  kind: "range" as const,
  from: pointId(from) as PointId,
  to: pointId(to) as PointId,
})

describe("historyView", () => {
  test("lists accepted work's kept line only, newest first; the oldest kept has no review", () => {
    const { entries } = view(["restore-a", "concurrent-a", "shown-a", "line-1"])
    expect(entries.map(e => [e.id, e.review])).toEqual([
      ["restore-a", range("shown-a", "restore-a")],
      ["shown-a", range("line-1", "shown-a")],
      ["line-1", null],
    ])
  })

  test("a concurrent save shows under its accept", () => {
    const { entries } = view(["restore-a", "concurrent-a", "shown-a"])
    expect(entries[1]?.saves.map(s => [s.id, s.words])).toEqual([
      ["concurrent-a", "written through a file held open across an accept"],
    ])
  })

  test("counts what is no longer kept, and offers no restore of the newest", () => {
    const shown = view(["restore-a", "shown-a"])
    expect(shown.notKept).toBe("2 older versions are no longer kept")
    expect(shown.entries.map(e => e.restore)).toEqual([
      null,
      { of: pointId("shown-a"), from: pointId("restore-a") },
    ])
  })
})

test("madeWords: each way accepted work's state is made", () => {
  const words = (s: StateRecord) => madeWords(s.made, () => "amber-fox", states)
  expect(STATES.filter(s => s.made.kind !== "start").map(words)).toEqual([
    "saved in the project's folder",
    "saved in the project's folder",
    "accepted amber-fox's changes",
    "written through a file held open across an accept",
    `restored the version of ${whenWords(3)}`,
  ])
})

test("whenWords: a moment to the minute, in this device's time", () => {
  expect(whenWords(new Date(2026, 4, 3, 14, 2).getTime())).toBe("3 May, 14:02")
})
