import {
  type ArchiveRecord,
  entryId,
  summarizeRoots,
  type WriterId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"
import { entry, indexOf } from "./fixtures.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const chat = (
  id: string,
  parentId: string | null,
  writer: WriterId,
  text: string,
) => entry(id, parentId, { role: "chat", content: text, author: "x", writer })
// Three roots, oldest first: r1 (Ada), r2 (Bea, archived), r3 (Bea; its newest
// message is older than r1's reply, so r1 has the newest activity).
const index = indexOf([
  chat("1-r1", null, ADA, "Plan the release"),
  chat("2-r2", null, BEA, "Old spike about SQLite"),
  chat("3-r3", null, BEA, "Notes on colour"),
  chat("4-r3", "3-r3", BEA, "more"),
  chat("5-r1", "1-r1", BEA, "release date is Friday"),
])
const roots = summarizeRoots(index)
const archived: ArchiveRecord = {
  root: entryId("2-r2"),
  state: "archived",
  by: ADA,
  at: 1,
}

const rows = (filter: ArchiveFilter, query = "", me = ADA) =>
  archiveIndex({
    roots,
    labels: new Map([[entryId("3-r3"), "Palette work"]]),
    archive: new Map([[entryId("2-r2"), archived]]),
    index,
    filter,
    query,
    me,
    cardRoots: new Set([entryId("3-r3")]),
  })
const ids = (r: ReturnType<typeof rows>) => r.map(x => x.summary.root)

describe("archiveIndex", () => {
  test("a row holds your card exactly when its root does", () => {
    expect(rows("all").map(r => [r.summary.root, r.card])).toEqual([
      ["1-r1", false],
      ["3-r3", true],
      ["2-r2", false],
    ])
  })

  test("every root, newest activity first, with its record", () => {
    const all = rows("all")
    expect(ids(all)).toEqual(["1-r1", "3-r3", "2-r2"])
    expect(all.map(r => r.record?.state ?? null)).toEqual([
      null,
      null,
      "archived",
    ])
  })
  test("filters by state, and to roots I wrote in", () => {
    expect(ids(rows("archived"))).toEqual(["2-r2"])
    expect(ids(rows("open"))).toEqual(["1-r1", "3-r3"])
    expect(ids(rows("mine"))).toEqual(["1-r1"])
    expect(ids(rows("mine", "", BEA))).toEqual(["1-r1", "3-r3", "2-r2"])
  })
  test("search is case-insensitive over any message in the root", () => {
    expect(ids(rows("all", "FRIDAY"))).toEqual(["1-r1"])
    expect(ids(rows("all", " sqlite "))).toEqual(["2-r2"])
    expect(ids(rows("all", "nothing like this"))).toEqual([])
  })
  test("search finds a root by its label, which no message holds", () => {
    expect(ids(rows("all", "palette"))).toEqual(["3-r3"])
  })
})
