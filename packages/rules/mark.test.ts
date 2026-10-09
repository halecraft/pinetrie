import { ERR, type MarkRecord, taskIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { MARK, planMark } from "./mark.ts"
import { recordsOf } from "./records.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const K1 = taskIdFor("01a0ffd2-0000-7000-8000-000000000001")
const K2 = taskIdFor("01a0ffd2-0000-7000-8000-000000000002")

const mark = (title: string): MarkRecord => ({
  task: K1,
  title,
  by: BEA,
  at: 1,
})

const plan = (
  over: Partial<Parameters<typeof planMark>[0]> = {},
): ReturnType<typeof planMark> =>
  planMark({
    task: K1,
    title: "Tab names",
    by: ADA,
    now: 5,
    tasks: new Set([K1, K2]),
    marks: new Map(),
    ...over,
  })

describe("the record", () => {
  test("round-trips at its task, in the session; a value with no title, or a key that is no task, is dropped", () => {
    const r = mark("Tab names")
    expect(MARK.home).toBe("session")
    expect(MARK.decode(MARK.encode(r), r.task)).toEqual(r)
    expect(MARK.decode({ ...r, title: "" }, r.task)).toBeUndefined()
    expect(MARK.decode(r, "r1")).toBeUndefined()
    expect(
      recordsOf(MARK, [
        { key: r.task, value: r },
        { key: K2, value: { nope: 1 } },
      ]).get(K1),
    ).toEqual(r)
  })
})

describe("planMark", () => {
  test("titles a task, by its writer, at now", () => {
    expect(plan()).toEqual({
      kind: "write",
      record: { task: K1, title: "Tab names", by: ADA, at: 5 },
    })
  })
  test("replaces another title: the last write wins", () => {
    expect(plan({ marks: new Map([[K1, mark("Old")]]) })).toMatchObject({
      kind: "write",
      record: { title: "Tab names", by: ADA },
    })
  })
  test("the title already stored writes nothing", () => {
    expect(plan({ marks: new Map([[K1, mark("Tab names")]]) })).toEqual({
      kind: "unchanged",
    })
  })
  test("clearing a title removes its record", () => {
    expect(plan({ title: null, marks: new Map([[K1, mark("Old")]]) })).toEqual({
      kind: "remove",
      task: K1,
    })
  })
  test("clearing a task with no title writes nothing", () => {
    expect(plan({ title: null })).toEqual({ kind: "unchanged" })
  })
  test("a task the session does not hold is refused", () => {
    expect(
      plan({ task: taskIdFor("01a0ffd2-0000-7000-8000-000000000009") }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  })
})
