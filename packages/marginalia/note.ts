// note — a note about a message, everyone's to edit (ADR-0025, ADR-0043).
//
// A note's text is its own Yjs document (`TextDoc` in @pineta/schema); its
// record, here, is a host-written `pineta.note` value keyed by note id
// (ADR-0016). The entry a note is about is never changed (ADR-0004): the model
// reads it as sent. The next message is drafted in a card (`card.ts`,
// ADR-0048), not a note.

import {
  ERR,
  entryId,
  type NoteAction,
  type NoteId,
  type NoteRecord,
  noteId,
  type Refusal,
  refused,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

/** pi value namespace for note records. The key is the note's id. */
export const NOTE_NAMESPACE = "pineta.note"

/**
 * The stored form. A note once had other subjects (a thread's draft, a sent
 * draft); only `entry` is left, and it is kept as a union's one case so that
 * every note stored before stays readable. A record with another subject is
 * an old draft, and does not decode.
 */
const NoteSchema = Type.Object({
  id: Type.String(),
  state: Type.Union([Type.Literal("open"), Type.Literal("done")]),
  subject: Type.Object({ kind: Type.Literal("entry"), id: Type.String() }),
  openedBy: Type.String(),
  contributors: Type.Array(Type.String()),
  reopened: Type.Boolean(),
  changedSinceDone: Type.Boolean(),
})

/** A note record -> the plain value stored in pi. */
export const encodeNote = ({
  entry,
  ...n
}: NoteRecord): Static<typeof NoteSchema> => ({
  ...n,
  contributors: [...n.contributors],
  subject: { kind: "entry", id: entry },
})

export const decodeNote = (value: unknown): NoteRecord | undefined =>
  decodeWith(NoteSchema, value, ({ subject, ...n }) => ({
    ...n,
    id: noteId(n.id),
    entry: entryId(subject.id),
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
 * Stored `note:` documents with no record that decodes: an old draft's, or
 * one whose record is gone. Pure; the host's startup sweep destroys them.
 */
export const orphanNotes = (
  stored: readonly string[],
  notes: readonly NoteRecord[],
  noteOfDoc: (docId: string) => NoteId | undefined,
): string[] => {
  const known = new Set<string>(notes.map(n => n.id))
  return stored.filter(docId => {
    const id = noteOfDoc(docId)
    return id !== undefined && !known.has(id)
  })
}

/** The note drawn with each message, by entry id (ADR-0043). */
export function messageNotes(
  notes: readonly NoteRecord[],
): ReadonlyMap<string, NoteRecord> {
  return new Map(notes.map(n => [n.entry, n]))
}

export type NoteDecision =
  /** A new note: write its record, and create its empty document. */
  | { readonly kind: "create"; readonly record: NoteRecord }
  /** The message already has its note. */
  | { readonly kind: "existing"; readonly id: NoteId }
  /** Write the record. */
  | { readonly kind: "update"; readonly record: NoteRecord }
  | Refusal

/**
 * Decide a note action. Pure; the host gathers every input inside one serial
 * step. The lifecycle:
 *
 * - `open` an entry: a new, empty note about it, or the one it already has;
 * - `done` an open note, and `reopen` a done one.
 */
export function planNote(input: {
  readonly action: NoteAction
  readonly writer: WriterId
  readonly notes: readonly NoteRecord[]
  readonly index: TreeIndex
  readonly newId: NoteId
}): NoteDecision {
  const { action, writer, notes, index } = input
  switch (action.kind) {
    case "open": {
      if (index.entries[action.entry] === undefined)
        return refused(ERR.UNKNOWN_TARGET, "no such message to open")
      const existing = notes.find(n => n.entry === action.entry)
      if (existing !== undefined) return { kind: "existing", id: existing.id }
      return {
        kind: "create",
        record: {
          id: input.newId,
          state: "open",
          entry: action.entry,
          openedBy: writer,
          contributors: [],
          reopened: false,
          changedSinceDone: false,
        },
      }
    }
    case "done":
    case "reopen": {
      const note = notes.find(n => n.id === action.note)
      if (note === undefined) return refused(ERR.UNKNOWN_TARGET, "no such note")
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
        ? { kind: "update", record: { ...note, state: "open", reopened: true } }
        : refused(ERR.NOTE_STATE, "only a done note is reopened")
    }
  }
}

/**
 * What one edit to a note's text changes in its record, or null for nothing.
 * Pure; the host calls it for each change to a note's document.
 *
 * - Contributors: each `clientID` whose clock moved, as a known writer, in
 *   order of first edit. A `clientID` no writer has, the host's own among
 *   them, is nobody's contribution.
 * - A reopened note, once edited by someone, is changed since done.
 */
export function planNoteEdit(
  note: NoteRecord,
  edit: {
    /** The `clientID`s whose clocks this change moved. */
    readonly changed: readonly number[]
    /** Each writer, by the `clientID` their edits carry (`authorsOf`). */
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
