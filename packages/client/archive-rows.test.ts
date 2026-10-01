import {
  type ArchiveRecord,
  type EntryLike,
  entryId,
  indexTree,
  type NoteRecord,
  noteId,
  summarizeRoots,
  type WriterId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { type ArchiveFilter, archiveIndex } from "./archive-rows.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const chat = (
  id: string,
  parentId: string | null,
  writer: WriterId,
  text: string,
): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role: "chat", content: text, author: "x", writer },
})
// Three roots, oldest first: r1 (Ada), r2 (Bea, archived), r3 (Bea; its newest
// message is older than r1's reply, so r1 has the newest activity).
const index = indexTree(
  Object.fromEntries(
    [
      chat("1-r1", null, ADA, "Plan the release"),
      chat("2-r2", null, BEA, "Old spike about SQLite"),
      chat("3-r3", null, BEA, "Notes on colour"),
      chat("4-r3", "3-r3", BEA, "more"),
      chat("5-r1", "1-r1", BEA, "release date is Friday"),
    ].map(e => [e.id, e]),
  ),
)
const roots = summarizeRoots(index)
const archived: ArchiveRecord = {
  root: entryId("2-r2"),
  state: "archived",
  by: ADA,
  at: 1,
}
const note = (id: string, on: string): NoteRecord => ({
  id: noteId(id),
  state: "open",
  entry: entryId(on),
  openedBy: ADA,
  contributors: [],
  reopened: false,
  changedSinceDone: false,
})

const rows = (filter: ArchiveFilter, query = "", me = ADA) =>
  archiveIndex({
    roots,
    labels: new Map([["3-r3", "Palette work"]]),
    archive: new Map([["2-r2", archived]]),
    notes: [note("n1", "5-r1"), note("n2", "1-r1"), note("n3", "2-r2")],
    index,
    filter,
    query,
    me,
    cardRoots: new Set(["3-r3"]),
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

  test("every root, newest activity first, with its record and note count", () => {
    const all = rows("all")
    expect(ids(all)).toEqual(["1-r1", "3-r3", "2-r2"])
    expect(all.map(r => [r.record?.state ?? null, r.notes])).toEqual([
      [null, 2],
      [null, 0],
      ["archived", 1],
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
