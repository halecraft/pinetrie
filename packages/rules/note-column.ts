// note-column — a note column's title (ADR-0116).
//
// A note column is a card on a task's canvas holding notes in one order
// (`notesIn`, `nearestNoteColumn`, `card.ts`). Its card says who made it,
// and its id when; its title is a host-written `pinetrie.note-column` value
// in the session, keyed by the column's id, set with `mark` as a task's
// title is (`planMark`). The last write wins, and clearing deletes it:
// untitled, a column reads `NEW_NOTES_TITLE`.

import type { NoteColumnId, NoteColumnRecord, WriterId } from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, noteColumnKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

// The shape only: the host stores only titles `parseTitle` accepted.
const NoteColumnSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/** Each titled note column's title, at its id. */
export const NOTE_COLUMN: RecordSpec<
  NoteColumnRecord,
  NoteColumnId,
  "session"
> = {
  namespace: "pinetrie.note-column",
  home: "session",
  keyOf: r => r.column,
  encode: ({ column, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(NoteColumnSchema, contents, noteColumnKey(key), (r, column) => ({
      column,
      title: r.title,
      by: r.by as WriterId,
      at: r.at,
    })),
}
