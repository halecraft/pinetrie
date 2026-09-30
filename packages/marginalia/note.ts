// note — a note about a message, everyone's to edit, or a thread's next
// message drafted together (ADR-0025, ADR-0043).
//
// A note's text is its own Yjs document (`NoteDoc` in @pineta/schema); its
// record, here, is a host-written `pineta.note` value keyed by note id
// (ADR-0016). The entry a note is about is never changed (ADR-0004): the model
// reads it as sent.

import {
  atEntry,
  type EntryId,
  ERR,
  entryId,
  type LaneName,
  type LaneView,
  type NoteAction,
  type NoteId,
  type NoteRecord,
  type NoteSubject,
  noteId,
  type Position,
  type Refusal,
  ROOT,
  refused,
  type TreeIndex,
  threadOf,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

/** pi value namespace for note records. The key is the note's id. */
export const NOTE_NAMESPACE = "pineta.note"

const SubjectSchema = Type.Union([
  Type.Object({ kind: Type.Literal("entry"), id: Type.String() }),
  Type.Object({
    kind: Type.Literal("draft"),
    /** An entry id; the root is never a draft's place. */
    at: Type.String(),
    lane: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("sent"), sendId: Type.String() }),
])

const NoteSchema = Type.Object({
  id: Type.String(),
  state: Type.Union([
    Type.Literal("draft"),
    Type.Literal("open"),
    Type.Literal("done"),
  ]),
  subject: SubjectSchema,
  openedBy: Type.String(),
  contributors: Type.Array(Type.String()),
  reopened: Type.Boolean(),
  changedSinceDone: Type.Boolean(),
})

const subjectToStored = (s: NoteSubject): Static<typeof SubjectSchema> =>
  s.kind === "draft"
    ? { kind: "draft", at: s.at.kind === "root" ? "" : s.at.id, lane: s.lane }
    : s

const subjectFromStored = (s: Static<typeof SubjectSchema>): NoteSubject => {
  switch (s.kind) {
    case "entry":
      return { kind: "entry", id: entryId(s.id) }
    case "draft":
      return {
        kind: "draft",
        at: s.at === "" ? ROOT : atEntry(entryId(s.at)),
        lane: s.lane as LaneName | null,
      }
    case "sent":
      return s
  }
}

/** A note record -> the plain value stored in pi. */
export const encodeNote = (n: NoteRecord) => ({
  ...n,
  subject: subjectToStored(n.subject),
})

export const decodeNote = (value: unknown): NoteRecord | undefined =>
  decodeWith(NoteSchema, value, n => ({
    ...n,
    id: noteId(n.id),
    subject: subjectFromStored(n.subject),
    openedBy: n.openedBy as WriterId,
    contributors: n.contributors as WriterId[],
  }))

/** Stored `pineta.note` values -> the records, oldest first (ids are uuidv7). */
export function noteRecords(
  values: Iterable<{ readonly value: unknown }>,
): readonly NoteRecord[] {
  return decodeAll(values, decodeNote).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

/**
 * The message a note belongs to, if it has one yet: the entry it is about, or
 * the message its draft was sent as. A sent draft that still waits in a
 * lane's outbox has none.
 */
function noteEntry(note: NoteRecord, index: TreeIndex): EntryId | null {
  switch (note.subject.kind) {
    case "entry":
      return note.subject.id
    case "sent": {
      const id = index.bySend.get(note.subject.sendId)
      return id === undefined ? null : entryId(id)
    }
    case "draft":
      return null
  }
}

/**
 * Where a note sits in the tree now: its message, or, for a draft, the end of
 * its thread, resolved as a reply from its place would be. Null for a sent
 * draft still waiting in an outbox, or a draft whose place is gone.
 */
export function noteAt(
  note: NoteRecord,
  lanes: readonly LaneView[],
  index: TreeIndex,
): string | null {
  if (note.subject.kind !== "draft") return noteEntry(note, index)
  const thread = threadOf(index, lanes, {
    at: note.subject.at,
    mode: "reply",
    lane: note.subject.lane,
    me: note.openedBy,
  })
  return thread.kind === "thread" && thread.end.kind === "entry"
    ? thread.end.id
    : null
}

/** The notes drawn with one message (ADR-0043). */
export interface MessageNotes {
  /** A note about it: opened on it (`subject.kind === "entry"`). */
  readonly about: NoteRecord | undefined
  /**
   * What it was sent from: a shared draft or a queued note. Its text is the
   * message's, so it is drawn only while it is not done, or once it has
   * changed since.
   */
  readonly origin: NoteRecord | undefined
}

/** Each message's notes to draw, by entry id. A message with none is absent. */
export function messageNotes(
  notes: readonly NoteRecord[],
  index: TreeIndex,
): ReadonlyMap<string, MessageNotes> {
  const out = new Map<string, MessageNotes>()
  for (const note of notes) {
    const shown =
      note.subject.kind === "entry" ||
      (note.subject.kind === "sent" &&
        (note.state !== "done" || note.changedSinceDone))
    const entry = shown ? noteEntry(note, index) : null
    if (entry === null) continue
    const was = out.get(entry) ?? { about: undefined, origin: undefined }
    out.set(
      entry,
      note.subject.kind === "entry"
        ? { ...was, about: note }
        : { ...was, origin: note },
    )
  }
  return out
}

/**
 * The draft of the thread that ends at `end`, if there is one: each draft's
 * place is resolved to its thread's end as it is now, so a draft follows its
 * thread as the thread grows. One draft per thread end. Pure.
 */
export function draftFor(
  end: string,
  lanes: readonly LaneView[],
  index: TreeIndex,
  notes: readonly NoteRecord[],
): NoteRecord | undefined {
  return notes.find(n => n.state === "draft" && noteAt(n, lanes, index) === end)
}

export type NoteDecision =
  /** A new note: write its record, and create its document holding `text`. */
  | {
      readonly kind: "create"
      readonly record: NoteRecord
      readonly text: string
    }
  /** The note asked for already exists: the message's, or the thread's draft. */
  | { readonly kind: "existing"; readonly id: NoteId }
  /** Write the record. */
  | { readonly kind: "update"; readonly record: NoteRecord }
  /** Send the draft's text as a reply from its place, then mark it sent. */
  | {
      readonly kind: "send"
      readonly record: NoteRecord
      readonly at: Position
      readonly lane: LaneName | null
    }
  | Refusal

/**
 * Decide a note action. Pure; the host gathers every input inside one serial
 * step. The lifecycle:
 *
 * - `open` an entry: a new, empty note about it, or the one it already has;
 * - `draft` where a reply would go: the thread's draft (`draftFor`), or a new one;
 * - `send` a draft: its text goes out as a reply from its place;
 * - `done` an open note or a draft, and `reopen` a done one.
 */
export function planNote(input: {
  readonly action: NoteAction
  readonly writer: WriterId
  readonly notes: readonly NoteRecord[]
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly newId: NoteId
}): NoteDecision {
  const { action, writer, notes, index, lanes } = input
  const fresh = (subject: NoteSubject, state: "open" | "draft") => ({
    id: input.newId,
    state,
    subject,
    openedBy: writer,
    contributors: [],
    reopened: false,
    changedSinceDone: false,
  })
  switch (action.kind) {
    case "open": {
      if (index.entries[action.entry] === undefined)
        return refused(ERR.UNKNOWN_TARGET, "no such message to open")
      // A message's origin note (`sent`) is where it came from, not a note
      // about it, so opening the message makes a new one.
      const existing = notes.find(
        n => n.subject.kind === "entry" && n.subject.id === action.entry,
      )
      if (existing !== undefined) return { kind: "existing", id: existing.id }
      return {
        kind: "create",
        record: fresh({ kind: "entry", id: action.entry }, "open"),
        text: "",
      }
    }
    case "draft": {
      const thread = threadOf(index, lanes, {
        at: action.at,
        mode: "reply",
        lane: action.lane,
        me: writer,
      })
      if (thread.kind === "ambiguous")
        return refused(ERR.UNKNOWN_TARGET, "two threads end there")
      if (thread.kind === "unknown" || thread.end.kind === "root")
        return refused(ERR.UNKNOWN_TARGET, "no thread to draft in there")
      const joined = draftFor(thread.end.id, lanes, index, notes)
      if (joined !== undefined) return { kind: "existing", id: joined.id }
      const record = fresh(
        { kind: "draft", at: action.at, lane: action.lane },
        "draft",
      )
      // What the requester had typed is theirs: the host only carries it in.
      return {
        kind: "create",
        record:
          action.text.trim() === ""
            ? record
            : { ...record, contributors: [writer] },
        text: action.text,
      }
    }
    case "send":
    case "done":
    case "reopen": {
      const note = notes.find(n => n.id === action.note)
      if (note === undefined) return refused(ERR.UNKNOWN_TARGET, "no such note")
      if (action.kind === "send") {
        return note.subject.kind === "draft"
          ? {
              kind: "send",
              record: note,
              at: note.subject.at,
              lane: note.subject.lane,
            }
          : refused(ERR.NOTE_STATE, "only a draft is sent")
      }
      if (action.kind === "done") {
        return note.state === "done"
          ? refused(ERR.NOTE_STATE, "already done")
          : {
              kind: "update",
              record: {
                ...note,
                state: "done",
                reopened: false,
                changedSinceDone: false,
              },
            }
      }
      return note.state === "done"
        ? {
            kind: "update",
            record: {
              ...note,
              state: note.subject.kind === "draft" ? "draft" : "open",
              reopened: true,
            },
          }
        : refused(ERR.NOTE_STATE, "only a done note is reopened")
    }
  }
}

/** A sent draft's record: done, and the text of the message its send wrote. */
export const sentNote = (note: NoteRecord, sendId: string): NoteRecord => ({
  ...note,
  state: "done",
  subject: { kind: "sent", sendId },
  reopened: false,
  changedSinceDone: false,
})

/**
 * What one edit to a note's text changes in its record, or null for nothing.
 * Pure; the host calls it for each change to a note's document.
 *
 * - Contributors: each `clientID` whose clock moved, as a known writer, in
 *   order of first edit. A `clientID` no writer has, the host's own seeding
 *   of an opened message among them, is nobody's contribution.
 * - A reopened note, once edited by someone, is changed since done.
 */
export function planNoteEdit(
  note: NoteRecord,
  edit: {
    /** The `clientID`s whose clocks this change moved. */
    readonly changed: readonly number[]
    /** Each writer, by the `clientID` their edits carry (`noteAuthors`). */
    readonly authors: ReadonlyMap<number, WriterId>
  },
): NoteRecord | null {
  const by = edit.changed.flatMap(c => {
    const w = edit.authors.get(c)
    return w === undefined ? [] : [w]
  })
  if (by.length === 0) return null
  const contributors = [...note.contributors]
  for (const w of by) if (!contributors.includes(w)) contributors.push(w)
  const changedSinceDone = note.changedSinceDone || note.reopened
  if (
    contributors.length === note.contributors.length &&
    changedSinceDone === note.changedSinceDone
  )
    return null
  return { ...note, contributors, changedSinceDone }
}
