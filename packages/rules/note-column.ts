// note-column — a note column's title.

import type { NoteColumnId, WriterId } from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, noteColumnKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

// The shape only: the host stores only titles `parseTitle` accepted.
const NoteColumnSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/**
 * A note column's title: a host-written `pinetrie.note-column` value in the
 * session, keyed by the column's id, absent while untitled. Who made the column
 * is its card's owner, and when is in its id.
 */
export interface NoteColumnRecord {
  readonly column: NoteColumnId
  readonly title: string
  /** The person who set it. */
  readonly by: WriterId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

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
