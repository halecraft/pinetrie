import { type LaneName, laneNameForThread, type ThreadName } from "@pineta/core"
import type { Moved } from "@pineta/repo"
import { describe, expect, test } from "vitest"
import { planMarks } from "./marks.ts"

describe("planMarks: what a move the owner observed refreshes", () => {
  const A = laneNameForThread("a")
  const B = laneNameForThread("b")
  const C = laneNameForThread("c")
  const names = new Map([
    [A, "amber-fox" as ThreadName],
    [B, "brave-owl" as ThreadName],
  ])
  const moved = (over: Partial<Moved> = {}): Moved => ({
    all: false,
    line: false,
    yours: false,
    lanes: new Set(),
    offers: new Set(),
    ...over,
  })
  const marks = (m: Moved, open: readonly LaneName[] = [C]) =>
    planMarks({ moved: m, names, open })
  test("everything moved marks the line, every named lane and every open record", () => {
    expect(marks(moved({ all: true, yours: true }))).toEqual({
      line: true,
      shared: false,
      lanes: [A, B, C],
    })
  })
  test("the publish bookmark marks the line's record, and no lane (ADR-0076)", () => {
    expect(marks(moved({ line: true }))).toEqual({
      line: true,
      shared: false,
      lanes: [],
    })
  })
  test("your @ alone marks no lane: one shared read rewrites your edits and the line's record", () => {
    expect(marks(moved({ yours: true }))).toEqual({
      line: false,
      shared: true,
      lanes: [],
    })
  })
  test("a lane's ref marks that lane alone, and not the line", () => {
    expect(marks(moved({ lanes: new Set([B]) }))).toEqual({
      line: false,
      shared: false,
      lanes: [B],
    })
  })
  test("an offer bookmark marks the lane its thread names; an unknown name marks none", () => {
    expect(
      marks(
        moved({
          offers: new Set(["amber-fox", "nobody-here"] as ThreadName[]),
        }),
      ),
    ).toEqual({ line: false, shared: false, lanes: [A] })
  })
  test("nothing moved marks nothing", () => {
    expect(marks(moved())).toEqual({ line: false, shared: false, lanes: [] })
  })
})
