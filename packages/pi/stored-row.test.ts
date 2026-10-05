// ADR-0015's split and rejoin, stated as tests.
//
// Co-located INSIDE packages/pi on purpose. `toStoredRow` takes pi's `Entry`,
// so a test in `test/` would have to import a pi type across the boundary that
// ADR-0003 exists to hold. Here the test is inside the boundary, and nothing
// pi-shaped escapes.
//
// The round-trip cases below are NOT sufficient on their own. A `payload` that
// duplicates the hoisted columns round-trips perfectly, because rejoining from
// either copy yields the same entry. Only the disjointness case sees that, so
// it comes first.

import { findSeqKeys } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type EntryWithoutSeq,
  fromStoredRow as rejoinWith,
  toStoredRow as splitWith,
} from "./stored-row.ts"

// An entry without images, stored where no blob is known.
const toStoredRow = (entry: EntryWithoutSeq) =>
  splitWith(entry, () => undefined)
const fromStoredRow = (row: ReturnType<typeof toStoredRow>, seq: number) =>
  rejoinWith(row, seq, () => undefined)

const HOISTED = ["id", "parentId", "type", "timestamp", "fromId"]

const message: EntryWithoutSeq = {
  id: "e2",
  parentId: "e1",
  type: "message" as const,
  timestamp: 1000,
  message: {
    role: "user",
    content: [{ type: "text", text: "hi" }],
    timestamp: 1000,
  },
}

const branchSummary: EntryWithoutSeq = {
  id: "e3",
  parentId: "e1",
  type: "branch_summary" as const,
  timestamp: 1001,
  fromId: "e9",
  summary: "explored the fold",
  fromHook: false,
}

const compaction: EntryWithoutSeq = {
  id: "e4",
  parentId: "e3",
  type: "compaction" as const,
  timestamp: 1002,
  summary: "squashed",
  retainedTail: [],
  tokensBefore: 42,
  fromHook: true,
}

const custom: EntryWithoutSeq = {
  id: "e5",
  parentId: null,
  type: "custom" as const,
  timestamp: 1003,
  customType: "note",
  data: { k: 1 },
}

describe("toStoredRow / fromStoredRow", () => {
  test("payload excludes every hoisted column", () => {
    // Two homes for parentId means two writers to one fact, and nothing keeps
    // them equal: planArrivals orders from the column, a renderer could read the
    // blob. The round-trip cases cannot detect this.
    for (const entry of [message, branchSummary, compaction, custom]) {
      const keys = Object.keys(
        toStoredRow(entry).payload as Record<string, unknown>,
      )
      expect(keys.filter(k => HOISTED.includes(k))).toEqual([])
    }
  })

  test("fromId: preserved on branch_summary, ABSENT on the others", () => {
    // The guaranteed null-vs-absent case: every message entry hits it, because
    // the column must hold null where pi carried no key at all.
    const back = fromStoredRow(toStoredRow(branchSummary), 1)
    expect(back).toHaveProperty("fromId", "e9")

    for (const entry of [message, compaction, custom]) {
      const rebuilt = fromStoredRow(toStoredRow(entry), 1)
      expect(Object.hasOwn(rebuilt, "fromId")).toBe(false)
    }
  })

  test("round-trips all four pi entry types", () => {
    for (const entry of [message, branchSummary, compaction, custom]) {
      const back = fromStoredRow(toStoredRow(entry), 7)
      expect(back).toEqual({ ...entry, seq: 7 })
    }
  })

  test("an absent optional stays absent, not null", () => {
    const back = fromStoredRow(toStoredRow(message), 1)
    expect(Object.hasOwn(back, "terminate")).toBe(false)
    expect(Object.hasOwn(back, "details")).toBe(false)
    expect(Object.hasOwn(back, "usage")).toBe(false)
  })

  test("parentId: null survives as null, not absent", () => {
    // null and absent are different facts; a nullable schema treats null as a
    // legitimate value, so neither may be collapsed into the other.
    const back = fromStoredRow(toStoredRow(custom), 1) as {
      parentId: string | null
    }
    expect(Object.hasOwn(back, "parentId")).toBe(true)
    expect(back.parentId).toBeNull()
  })

  test("no seq reaches the row (ADR-0013, now structural)", () => {
    const withSeq = { ...message, seq: 99 }
    expect(findSeqKeys(toStoredRow(withSeq))).toEqual([])
  })

  test("an unknown future entry type passes through intact", () => {
    // `type` is an unconstrained string precisely so a new pi EntryType needs
    // no schema change here.
    // The ONLY cast in this file, and it is the point of the test: pi has no
    // such entry type today, so the fixture cannot satisfy `EntryWithoutSeq`.
    // Every other fixture is typed, so a change to pi's `Entry` breaks this
    // file at compile time rather than passing while covering nothing.
    const future = {
      id: "e6",
      parentId: "e5",
      type: "not_yet_invented",
      timestamp: 1004,
      somethingNew: { deep: [1, 2, 3] },
    }
    expect(fromStoredRow(toStoredRow(future as never), 3)).toEqual({
      ...future,
      seq: 3,
    })
  })
})
