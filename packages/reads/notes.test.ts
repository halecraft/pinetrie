import {
  atEntry,
  type EntryLike,
  entryId,
  indexTree,
  type NoteRecord,
  noteId,
  writerId,
} from "@pineta/core"
import { expect, test } from "vitest"
import { type NOTE_FILTERS, notesIndex } from "./index.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const index = indexTree(
  Object.fromEntries(
    ["e1", "e2"].map((id, i): [string, EntryLike] => [
      id,
      {
        id,
        parentId: i === 0 ? null : "e1",
        type: "message",
        message: { role: "user", content: id },
      },
    ]),
  ),
)
const note = (id: string, over: Partial<NoteRecord>): NoteRecord => ({
  id: noteId(id),
  state: "open",
  subject: { kind: "entry", id: entryId("e1") },
  openedBy: ADA,
  contributors: [],
  reopened: false,
  changedSinceDone: false,
  ...over,
})
const notes = [
  note("n1", {}),
  note("n2", {
    state: "draft",
    subject: { kind: "draft", at: atEntry(entryId("e1")), lane: null },
    openedBy: BEA,
  }),
  note("n3", { state: "done", openedBy: BEA, contributors: [ADA] }),
  note("n4", { reopened: true, changedSinceDone: true, openedBy: BEA }),
]

test("notesIndex: newest first, each filter keeping its kind", () => {
  const ids = (filter: (typeof NOTE_FILTERS)[number], me = ADA) =>
    notesIndex(notes, index, [], filter, me, "e1").map(r => r.note.id)
  expect(ids("all")).toEqual(["n4", "n3", "n2", "n1"])
  expect(ids("draft")).toEqual(["n2"])
  expect(ids("open")).toEqual(["n4", "n1"])
  expect(ids("done")).toEqual(["n3"])
  expect(ids("changed")).toEqual(["n4"])
  expect(ids("mine")).toEqual(["n3", "n1"])
  expect(ids("mine", BEA)).toEqual(["n4", "n3", "n2"])
})

test("notesIndex: each row sits where its note does; a draft at its thread's end", () => {
  const at = notesIndex(notes, index, [], "all", ADA, "e1").map(r => r.at)
  expect(at).toEqual(["e1", "e1", "e2", "e1"])
})

test("notesIndex: only the notes whose place is in the root", () => {
  const two = indexTree({
    ...index.entries,
    r2: {
      id: "r2",
      parentId: null,
      type: "message",
      message: { role: "user", content: "r2" },
    },
  })
  const elsewhere = note("n5", {
    subject: { kind: "entry", id: entryId("r2") },
  })
  const ids = (root: string) =>
    notesIndex([...notes, elsewhere], two, [], "all", ADA, root).map(
      r => r.note.id,
    )
  expect(ids("r2")).toEqual(["n5"])
  expect(ids("e1")).toEqual(["n4", "n3", "n2", "n1"])
})
