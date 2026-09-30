import {
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type NoteAction,
  type NoteRecord,
  noteId,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  decodeNote,
  encodeNote,
  messageNotes,
  orphanNotes,
  planNote,
  planNoteEdit,
} from "./note.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const E2 = entryId("e2")
const E4 = entryId("e4")

const entry = (id: string, parentId: string | null): EntryLike => ({
  id,
  parentId,
  type: "message",
  message: { role: "user", content: `text of ${id}` },
})
/** e1 -> e2, with a sibling fork e1 -> f1. */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexTree(
    Object.fromEntries(
      [entry("e1", null), entry("e2", "e1"), entry("f1", "e1"), ...more].map(
        e => [e.id, e],
      ),
    ),
  )

const note = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: noteId("n-1"),
  state: "open",
  entry: E2,
  openedBy: ADA,
  contributors: [],
  reopened: false,
  changedSinceDone: false,
  ...over,
})

const plan = (action: NoteAction, notes: readonly NoteRecord[] = []) =>
  planNote({
    action,
    writer: BEA,
    notes,
    index: tree(),
    newId: noteId("n-new"),
  })

describe("planNote: the lifecycle", () => {
  test("open: a new, empty note about the message", () => {
    expect(plan({ kind: "open", entry: E2 })).toEqual({
      kind: "create",
      record: {
        id: "n-new",
        state: "open",
        entry: E2,
        openedBy: BEA,
        contributors: [],
        reopened: false,
        changedSinceDone: false,
      },
    })
  })

  test("open twice gives the same note", () => {
    expect(plan({ kind: "open", entry: E2 }, [note()])).toEqual({
      kind: "existing",
      id: "n-1",
    })
  })

  test("open: a message the tree does not hold is refused", () => {
    const d = plan({ kind: "open", entry: E4 })
    expect(d.kind === "refused" && d.code).toBe(ERR.UNKNOWN_TARGET)
  })

  test("done, then reopen: a reopened note is back to what it was", () => {
    const open = note()
    const done = plan({ kind: "done", note: open.id }, [open])
    expect(done.kind === "update" && done.record.state).toBe("done")
    if (done.kind !== "update") return
    const again = plan({ kind: "done", note: open.id }, [done.record])
    expect(again.kind === "refused" && again.code).toBe(ERR.NOTE_STATE)
    const reopened = plan({ kind: "reopen", note: open.id }, [done.record])
    expect(
      reopened.kind === "update" && [
        reopened.record.state,
        reopened.record.reopened,
      ],
    ).toEqual(["open", true])
    const notDone = plan({ kind: "reopen", note: open.id }, [open])
    expect(notDone.kind === "refused" && notDone.code).toBe(ERR.NOTE_STATE)
  })

  test("an action on a note that does not exist is refused", () => {
    const d = plan({ kind: "done", note: noteId("n-none") })
    expect(d.kind === "refused" && d.code).toBe(ERR.UNKNOWN_TARGET)
  })
})

test("messageNotes: each message's note, by its entry", () => {
  const other = note({ id: noteId("n-2"), entry: entryId("f1") })
  const drawn = messageNotes([note(), other])
  expect(drawn.get(E2)).toEqual(note())
  expect(drawn.get("f1")).toEqual(other)
  expect(drawn.has("e1")).toBe(false)
})

describe("planNoteEdit", () => {
  const authors = new Map([
    [11, ADA],
    [22, BEA],
  ])
  const open = note()

  test("contributors in order of first edit; an unknown clientID is nobody", () => {
    const first = planNoteEdit(open, { changed: [22, 99], authors })
    expect(first?.contributors).toEqual([BEA])
    if (first === null) return
    const second = planNoteEdit(first, { changed: [11, 22], authors })
    expect(second?.contributors).toEqual([BEA, ADA])
  })

  test("null when nothing changes: a known contributor, or only unknown ids", () => {
    const withBea = { ...open, contributors: [BEA] }
    expect(planNoteEdit(withBea, { changed: [22], authors })).toBeNull()
    expect(planNoteEdit(open, { changed: [99], authors })).toBeNull()
  })

  test("a reopened note, once edited, is changed since done; one never done is not", () => {
    const withBea = { ...open, contributors: [BEA] }
    expect(planNoteEdit(withBea, { changed: [22], authors })).toBeNull()
    const reopened = { ...withBea, reopened: true }
    expect(
      planNoteEdit(reopened, { changed: [22], authors })?.changedSinceDone,
    ).toBe(true)
    expect(planNoteEdit(reopened, { changed: [99], authors })).toBeNull()
  })
})

describe("storage", () => {
  test("a record round-trips, in the stored shape notes have always had", () => {
    const n = note({ state: "done", contributors: [ADA] })
    const stored = JSON.parse(JSON.stringify(encodeNote(n)))
    expect(stored.subject).toEqual({ kind: "entry", id: "e2" })
    expect(stored.entry).toBeUndefined()
    expect(decodeNote(stored)).toEqual(n)
  })

  test("a note stored before cards still decodes", () => {
    const before = {
      id: "n-old",
      state: "open",
      subject: { kind: "entry", id: "e2" },
      openedBy: "p-ada",
      contributors: ["p-ada"],
      reopened: false,
      changedSinceDone: false,
    }
    expect(decodeNote(before)?.entry).toBe(E2)
  })

  test("an old draft, a sent draft and a malformed record do not decode", () => {
    const base = {
      id: "n",
      state: "done",
      openedBy: "p-ada",
      contributors: [],
      reopened: false,
      changedSinceDone: false,
    }
    expect(
      decodeNote({
        ...base,
        state: "draft",
        subject: { kind: "draft", at: "e2", lane: null },
      }),
    ).toBeUndefined()
    expect(
      decodeNote({ ...base, subject: { kind: "sent", sendId: "s-1" } }),
    ).toBeUndefined()
    expect(decodeNote({ id: "n", state: "lost" })).toBeUndefined()
  })
})

test("orphanNotes: stored note documents whose record is gone or no longer decodes", () => {
  const ofDoc = (docId: string) =>
    docId.startsWith("note:") ? noteId(docId.slice(5)) : undefined
  expect(
    orphanNotes(["note:n-1", "note:old-draft", "card:c-1"], [note()], ofDoc),
  ).toEqual(["note:old-draft"])
})
