// note-column — a note column's title.

import type { NoteColumnId, NoteColumnRecord, WriterId } from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, noteColumnKey } from "./decode.ts"
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
    decodeRecord(
      NoteColumnSchema,
      contents,
      noteColumnKey(key),
      (r, column) => ({
        column,
        title: r.title,
        by: r.by as WriterId,
        at: r.at,
      }),
    ),
}
