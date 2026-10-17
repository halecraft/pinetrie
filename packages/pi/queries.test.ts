// The rules of pi's reads, over stored rows (`queries.ts`).
import type { StoredEntryRow } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import {
  boundsAfter,
  compareKeys,
  entryStructure,
  inBounds,
  type Located,
  selectBranch,
} from "./queries.ts"

const at = (
  id: string,
  seq: number,
  type = "message",
  payload: Record<string, unknown> = {},
): Located => ({
  row: {
    id,
    parentId: null,
    type,
    timestamp: seq,
    fromId: null,
    payload,
  } as StoredEntryRow,
  seq,
})

// A walked branch, newest first.
const path = [
  at("d", 4),
  at("c", 3, "custom", { customType: "note" }),
  at("b", 2, "compaction"),
  at("a", 1),
]
const ids = (located: readonly Located[]) => located.map(l => l.row.id)

describe("boundsAfter", () => {
  test("a cursor excludes its own seq, in both orders", () => {
    expect(
      [1, 2, 3].filter(s => inBounds(s, boundsAfter(true, { seq: 2 }))),
    ).toEqual([3])
    expect(
      [1, 2, 3].filter(s => inBounds(s, boundsAfter(false, { seq: 2 }))),
    ).toEqual([1])
    expect(boundsAfter(true, undefined)).toEqual({})
  })
})

describe("selectBranch", () => {
  test("stops at an id or a type, keeping the stop entry", () => {
    expect(
      ids(selectBranch(path, { start: "d", stopAtType: "compaction" })),
    ).toEqual(["d", "c", "b"])
    expect(
      ids(
        selectBranch(path, { start: "d", stopAtId: "c", order: "newestFirst" }),
      ),
    ).toEqual(["d", "c"])
    expect(
      ids(
        selectBranch(path, { start: "d", stopAtId: "b", order: "oldestFirst" }),
      ),
    ).toEqual(["a", "b"])
  })
  test("filters by type, by customType from the payload, by cursor, and limits", () => {
    expect(ids(selectBranch(path, { start: "d", customType: "note" }))).toEqual(
      ["c"],
    )
    expect(ids(selectBranch(path, { start: "d", type: "message" }))).toEqual([
      "d",
      "a",
    ])
    expect(
      ids(
        selectBranch(path, {
          start: "d",
          order: "oldestFirst",
          cursor: { seq: 2 },
        }),
      ),
    ).toEqual(["c", "d"])
    expect(ids(selectBranch(path, { start: "d", limit: 1 }))).toEqual(["d"])
  })
})

test("entryStructure keeps customType only where the payload has one", () => {
  expect(
    entryStructure(at("c", 3, "custom", { customType: "note", data: 1 })),
  ).toEqual({
    id: "c",
    parentId: null,
    seq: 3,
    timestamp: 3,
    type: "custom",
    customType: "note",
  })
  expect(Object.hasOwn(entryStructure(at("a", 1)), "customType")).toBe(false)
})

test("compareKeys orders by code point, so an astral character sorts after U+FFFF", () => {
  expect(["\u{1F600}", "\uFFFF"].sort(compareKeys)).toEqual([
    "\uFFFF",
    "\u{1F600}",
  ])
})
