import {
  atEntry,
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type LaneView,
  laneNameForThread,
  type NoteAction,
  type NoteRecord,
  noteId,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  decodeNote,
  draftFor,
  encodeNote,
  noteAt,
  planNote,
  planNoteEdit,
  sentNote,
} from "./note.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")
const E1 = entryId("e1")
const E2 = entryId("e2")
const E3 = entryId("e3")
const E4 = entryId("e4")
const F1 = entryId("f1")

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

const draft = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: noteId("n-draft"),
  state: "draft",
  subject: { kind: "draft", at: atEntry(E2), lane: null },
  openedBy: ADA,
  contributors: [],
  reopened: false,
  changedSinceDone: false,
  ...over,
})

const plan = (
  action: NoteAction,
  notes: readonly NoteRecord[] = [],
  index: TreeIndex = tree(),
  lanes: readonly LaneView[] = [],
) =>
  planNote({
    action,
    writer: BEA,
    notes,
    index,
    lanes,
    entryText: action.kind === "open" ? "as sent" : undefined,
    newId: noteId("n-new"),
  })

describe("planNote: the lifecycle", () => {
  test("open: a new note holding the message's text", () => {
    const d = plan({ kind: "open", entry: E2 })
    expect(d).toEqual({
      kind: "create",
      text: "as sent",
      record: {
        id: "n-new",
        state: "open",
        subject: { kind: "entry", id: E2 },
        openedBy: BEA,
        contributors: [],
        reopened: false,
        changedSinceDone: false,
      },
    })
  })

  test("open twice gives the same note, and a sent draft is its message's note", () => {
    const opened = draft({
      id: noteId("n-1"),
      state: "open",
      subject: { kind: "entry", id: E2 },
    })
    expect(plan({ kind: "open", entry: E2 }, [opened])).toEqual({
      kind: "existing",
      id: "n-1",
    })
    const sent = sentNote(draft({ id: noteId("n-2") }), "s-9")
    const index = tree({
      ...entry("e3", "e2"),
      message: { role: "chat", content: "hi", sendId: "s-9" },
    })
    expect(plan({ kind: "open", entry: E3 }, [sent], index)).toEqual({
      kind: "existing",
      id: "n-2",
    })
  })

  test("open: a message the tree does not hold is refused", () => {
    const d = planNote({
      action: { kind: "open", entry: E4 },
      writer: BEA,
      notes: [],
      index: tree(),
      lanes: [],
      entryText: undefined,
      newId: noteId("n-new"),
    })
    expect(d.kind === "refused" && d.code).toBe(ERR.UNKNOWN_TARGET)
  })

  test("draft joins the thread's draft, wherever along it that was started", () => {
    const d = plan({ kind: "draft", at: atEntry(E1), lane: null, text: "" }, [
      draft({ subject: { kind: "draft", at: atEntry(E2), lane: null } }),
    ])
    // A reply from e1 continues its newest leaf: f1, not e2's thread.
    expect(d.kind).toBe("create")
    const joined = plan(
      { kind: "draft", at: atEntry(E2), lane: null, text: "" },
      [draft()],
    )
    expect(joined).toEqual({ kind: "existing", id: "n-draft" })
  })

  test("draft: a new draft keeps its place and what its sender typed", () => {
    const lane = laneNameForThread("x")
    const lanes: LaneView[] = [
      { name: lane, tip: E2, running: false, waiting: 0, askedBy: null },
    ]
    const d = plan(
      { kind: "draft", at: atEntry(E2), lane, text: "so far" },
      [],
      tree(),
      lanes,
    )
    expect(
      d.kind === "create" && [d.record.subject, d.text, d.record.contributors],
    ).toEqual([{ kind: "draft", at: atEntry(E2), lane }, "so far", [BEA]])
  })

  test("send: only a draft, from its place", () => {
    expect(plan({ kind: "send", note: noteId("n-draft") }, [draft()])).toEqual({
      kind: "send",
      record: draft(),
      at: atEntry(E2),
      lane: null,
    })
    const open = draft({ state: "open", subject: { kind: "entry", id: E2 } })
    const d = plan({ kind: "send", note: noteId("n-draft") }, [open])
    expect(d.kind === "refused" && d.code).toBe(ERR.NOTE_STATE)
  })

  test("done, then reopen: a reopened note is back to what it was", () => {
    const open = draft({ state: "open", subject: { kind: "entry", id: E2 } })
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

describe("draftFor", () => {
  test("still finds a draft after its thread grows", () => {
    const grown = tree(entry("e3", "e2"), entry("e4", "e3"))
    expect(draftFor(E4, [], grown, [draft()])?.id).toBe("n-draft")
    expect(draftFor(E2, [], grown, [draft()])).toBeUndefined()
  })

  test("a draft on a sibling thread is not this thread's", () => {
    expect(draftFor(F1, [], tree(), [draft()])).toBeUndefined()
  })

  test("a lane-bound draft follows its lane, not the newest leaf", () => {
    const lane = laneNameForThread("x")
    const bound = draft({ subject: { kind: "draft", at: atEntry(E1), lane } })
    const lanes: LaneView[] = [
      { name: lane, tip: E2, running: false, waiting: 0, askedBy: null },
    ]
    // Unbound, a reply from e1 continues its newest leaf, f1.
    expect(
      noteAt(
        draft({ subject: { kind: "draft", at: atEntry(E1), lane: null } }),
        lanes,
        tree(),
      ),
    ).toBe(F1)
    expect(draftFor(E2, lanes, tree(), [bound])?.id).toBe("n-draft")
  })

  test("a done draft is no one's draft", () => {
    expect(draftFor(E2, [], tree(), [draft({ state: "done" })])).toBeUndefined()
  })
})

describe("planNoteEdit", () => {
  const authors = new Map([
    [11, ADA],
    [22, BEA],
  ])
  const open = draft({ state: "open", subject: { kind: "entry", id: E2 } })

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

test("a record round-trips through storage; a malformed one is dropped", () => {
  const lane = laneNameForThread("x")
  for (const n of [
    draft({ subject: { kind: "draft", at: atEntry(E2), lane } }),
    draft({
      state: "open",
      subject: { kind: "entry", id: E2 },
      contributors: [ADA],
    }),
    sentNote(draft(), "s-1"),
  ])
    expect(decodeNote(JSON.parse(JSON.stringify(encodeNote(n))))).toEqual(n)
  expect(decodeNote({ id: "n", state: "lost" })).toBeUndefined()
})
