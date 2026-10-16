import {
  canvasIdFor,
  cardIdOfKind,
  ERR,
  type MarkRecord,
  type NoteColumnRecord,
  THE_AGENT,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { MARK, planMark } from "./mark.ts"
import { NOTE_COLUMN } from "./note-column.ts"
import { deleteRecord, recordsOf, setRecord } from "./records.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const K1 = canvasIdFor("01a0ffd2-0000-7000-8000-000000000001")
const K2 = canvasIdFor("01a0ffd2-0000-7000-8000-000000000002")
const N1 = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-000000000003")

const mark = (title: string): MarkRecord => ({
  canvas: K1,
  title,
  by: BEA,
  at: 1,
})
const titled = (title: string): NoteColumnRecord => ({
  column: N1,
  title,
  by: BEA,
  at: 1,
})

const plan = (
  over: Partial<Parameters<typeof planMark>[0]> = {},
): ReturnType<typeof planMark> =>
  planMark({
    of: { kind: "canvas", canvas: K1 },
    title: "Tab names",
    by: ADA,
    now: 5,
    canvases: new Set([K1, K2]),
    marks: new Map(),
    columns: new Set([N1]),
    columnTitles: new Map(),
    ...over,
  })

describe("the records", () => {
  test("a canvas's title round-trips at its canvas; a malformed one is dropped", () => {
    const r = mark("Tab names")
    expect(MARK.home).toBe("session")
    expect(MARK.decode(MARK.encode(r), r.canvas)).toEqual(r)
    expect(MARK.decode({ ...r, title: "" }, r.canvas)).toBeUndefined()
    expect(MARK.decode(r, "r1")).toBeUndefined()
    expect(
      recordsOf(MARK, [
        { key: r.canvas, value: r },
        { key: K2, value: { nope: 1 } },
      ]).get(K1),
    ).toEqual(r)
  })
  test("a note column's title round-trips at its column, in the session; a key that is no note column is dropped", () => {
    const r = titled("Ideas")
    expect(NOTE_COLUMN.home).toBe("session")
    expect(NOTE_COLUMN.decode(NOTE_COLUMN.encode(r), r.column)).toEqual(r)
    expect(NOTE_COLUMN.decode(NOTE_COLUMN.encode(r), K1)).toBeUndefined()
    expect(
      NOTE_COLUMN.decode({ title: "", by: BEA, at: 1 }, r.column),
    ).toBeUndefined()
  })
})

describe("planMark", () => {
  test("titles a canvas, by its writer, at now", () => {
    expect(plan()).toEqual({
      kind: "writes",
      writes: [
        setRecord(MARK, { canvas: K1, title: "Tab names", by: ADA, at: 5 }),
      ],
    })
  })
  test("replaces another title: the last write wins", () => {
    expect(plan({ marks: new Map([[K1, mark("Old")]]) })).toEqual({
      kind: "writes",
      writes: [
        setRecord(MARK, { canvas: K1, title: "Tab names", by: ADA, at: 5 }),
      ],
    })
  })
  test("the title already stored writes nothing", () => {
    expect(plan({ marks: new Map([[K1, mark("Tab names")]]) })).toEqual({
      kind: "unchanged",
    })
  })
  test("clearing a title removes its record", () => {
    expect(plan({ title: null, marks: new Map([[K1, mark("Old")]]) })).toEqual({
      kind: "writes",
      writes: [deleteRecord(MARK, K1)],
    })
  })
  test("clearing a canvas with no title writes nothing", () => {
    expect(plan({ title: null })).toEqual({ kind: "unchanged" })
  })
  test("a canvas the session does not hold is refused", () => {
    expect(
      plan({
        of: {
          kind: "canvas",
          canvas: canvasIdFor("01a0ffd2-0000-7000-8000-000000000009"),
        },
      }),
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
  })
  test("titles a note column in its own record, and clears it there", () => {
    const of = { kind: "note-column", column: N1 } as const
    expect(plan({ of, title: "Ideas" })).toEqual({
      kind: "writes",
      writes: [
        setRecord(NOTE_COLUMN, { column: N1, title: "Ideas", by: ADA, at: 5 }),
      ],
    })
    expect(
      plan({
        of,
        title: null,
        columnTitles: new Map([[N1, titled("Ideas")]]),
      }),
    ).toEqual({ kind: "writes", writes: [deleteRecord(NOTE_COLUMN, N1)] })
    expect(
      plan({
        of,
        title: "Ideas",
        columnTitles: new Map([[N1, titled("Ideas")]]),
      }),
    ).toEqual({ kind: "unchanged" })
  })
  test("a note column on no canvas, or one the agent would title, is refused", () => {
    const of = { kind: "note-column", column: N1 } as const
    expect(plan({ of, columns: new Set() })).toMatchObject({
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
    })
    expect(plan({ of, by: THE_AGENT })).toMatchObject({
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
    })
  })
})
