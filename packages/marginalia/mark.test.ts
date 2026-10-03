import {
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type MarkRecord,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { MARK, planMark } from "./mark.ts"
import { recordsOf } from "./records.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  type: "message",
  message: { role: "user", content: id },
})
const index = indexTree(
  Object.fromEntries([entry("r1", null), entry("a", "r1")].map(e => [e.id, e])),
)

const mark = (at: string, title: string): MarkRecord => ({
  entry: entryId(at),
  title,
  by: BEA,
  at: 1,
})

const plan = (
  over: Partial<Parameters<typeof planMark>[0]> = {},
): ReturnType<typeof planMark> =>
  planMark({
    entry: entryId("r1"),
    title: "Tab names",
    by: ADA,
    now: 5,
    index,
    marks: new Map(),
    ...over,
  })

describe("the record", () => {
  test("round-trips, and a value with no title or no entry is dropped", () => {
    const r = mark("r1", "Tab names")
    expect(MARK.decode(MARK.encode(r), r.entry)).toEqual(r)
    expect(MARK.decode({ ...r, title: "" }, r.entry)).toBeUndefined()
    expect(MARK.decode(r, "")).toBeUndefined()
    expect(
      recordsOf(MARK, [
        { key: r.entry, value: r },
        { key: "r2", value: { nope: 1 } },
      ]).get(entryId("r1")),
    ).toEqual(r)
  })
})

describe("planMark", () => {
  test("titles an entry, by its writer, at now", () => {
    expect(plan()).toEqual({
      kind: "write",
      record: { entry: "r1", title: "Tab names", by: ADA, at: 5 },
    })
  })
  test("replaces another title: the last write wins", () => {
    expect(
      plan({ marks: new Map([[entryId("r1"), mark("r1", "Old")]]) }),
    ).toMatchObject({ kind: "write", record: { title: "Tab names", by: ADA } })
  })
  test("any entry in the tree takes a mark, not only a root", () => {
    expect(plan({ entry: entryId("a") })).toMatchObject({ kind: "write" })
  })
  test("the title already stored writes nothing", () => {
    expect(
      plan({ marks: new Map([[entryId("r1"), mark("r1", "Tab names")]]) }),
    ).toEqual({ kind: "unchanged" })
  })
  test("clearing a title removes its record", () => {
    expect(
      plan({
        title: null,
        marks: new Map([[entryId("r1"), mark("r1", "Old")]]),
      }),
    ).toEqual({ kind: "remove", entry: "r1" })
  })
  test("clearing an entry with no title writes nothing", () => {
    expect(plan({ title: null })).toEqual({ kind: "unchanged" })
  })
  test("an entry the tree does not hold is refused", () => {
    expect(plan({ entry: entryId("gone") })).toMatchObject({
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
    })
  })
})
