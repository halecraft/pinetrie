import { type ThreadId, type ThreadName, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planMarks } from "./marks.ts"
import type { Moved } from "./observe.ts"

describe("planMarks: what a move the owner observed refreshes", () => {
  const A = threadIdFor("a")
  const B = threadIdFor("b")
  const C = threadIdFor("c")
  // D's root is archived.
  const D = threadIdFor("d")
  const names = new Map([
    [A, "amber-fox" as ThreadName],
    [B, "brave-owl" as ThreadName],
    [D, "dusty-elk" as ThreadName],
  ])
  const archived = new Set([D])
  const moved = (over: Partial<Moved> = {}): Moved => ({
    all: false,
    acceptedMoved: false,
    published: false,
    workingCopy: false,
    lanes: new Set(),
    proposed: new Set(),
    ...over,
  })
  const marks = (m: Moved, open: readonly ThreadId[] = [C]) =>
    planMarks({ moved: m, names, archived, open })
  test("everything moved marks accepted work, every named lane not archived and every open record", () => {
    expect(marks(moved({ all: true, workingCopy: true }))).toEqual({
      accepted: true,
      shared: false,
      lanes: [A, B, C],
    })
  })
  test("an archived lane is still marked by its ref, its proposed bookmark or an open record", () => {
    expect(marks(moved({ lanes: new Set([D]) })).lanes).toEqual([D])
    expect(
      marks(moved({ proposed: new Set(["dusty-elk"] as ThreadName[]) })).lanes,
    ).toEqual([D])
    expect(marks(moved({ all: true }), [D]).lanes).toEqual([A, B, D])
  })
  test("the publish bookmark marks accepted work's record, and no lane", () => {
    expect(marks(moved({ published: true }))).toEqual({
      accepted: true,
      shared: false,
      lanes: [],
    })
  })
  test("your @ alone marks no lane: one shared read rewrites your edits and accepted work's record", () => {
    expect(marks(moved({ workingCopy: true }))).toEqual({
      accepted: false,
      shared: true,
      lanes: [],
    })
  })
  test("a lane's ref marks that lane alone, and not accepted work", () => {
    expect(marks(moved({ lanes: new Set([B]) }))).toEqual({
      accepted: false,
      shared: false,
      lanes: [B],
    })
  })
  test("proposed bookmark marks the lane its thread names; an unknown name marks none", () => {
    expect(
      marks(
        moved({
          proposed: new Set(["amber-fox", "nobody-here"] as ThreadName[]),
        }),
      ),
    ).toEqual({ accepted: false, shared: false, lanes: [A] })
  })
  test("nothing moved marks nothing", () => {
    expect(marks(moved())).toEqual({
      accepted: false,
      shared: false,
      lanes: [],
    })
  })
})
