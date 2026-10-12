// roots — the directory of roots: what the sidebar, the board and your inbox
// read of a root without opening its document.

import {
  type EntryId,
  entryId,
  isThreadId,
  type RootId,
  type RootRecord,
  type Sha256,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, rootKey, ThreadIdSchema } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const Id = Type.String({ minLength: 1 })
const RootRecordSchema = Type.Object({
  entry: Type.Union([Id, Type.Null()]),
  first: Type.Union([Id, Type.Null()]),
  firstLine: Type.String(),
  messages: Type.Number(),
  newest: Type.Union([Id, Type.Null()]),
  writers: Type.Array(Type.String()),
  threads: Type.Record(Type.String(), Type.Array(Type.String())),
  mentions: Type.Array(
    Type.Object({
      id: Id,
      by: Type.String(),
      text: Type.String(),
      thread: ThreadIdSchema,
    }),
  ),
  images: Type.Array(Type.String()),
})

const idOrNull = (id: string | null): EntryId | null =>
  id === null ? null : entryId(id)

/** Each thread's writers, a key that is no lane name dropped. */
const threadsOf = (
  threads: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<ThreadId, readonly WriterId[]>> =>
  Object.fromEntries(
    Object.entries(threads).flatMap(([lane, writers]) =>
      isThreadId(lane) ? [[lane, writers as WriterId[]]] : [],
    ),
  )

/**
 * Each root's directory record, at its id. Derived from the root's document
 * alone, so a record that does not decode in this build's shape is rebuilt
 * at a host's start (`host/directory.ts`), never migrated.
 */
export const ROOT: RecordSpec<RootRecord, RootId, "session"> = {
  namespace: "pinetrie.root",
  home: "session",
  derived: true,
  keyOf: r => r.root,
  encode: ({ root, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(RootRecordSchema, contents, rootKey(key), (r, root) => ({
      root,
      entry: idOrNull(r.entry),
      first: idOrNull(r.first),
      firstLine: r.firstLine,
      messages: r.messages,
      newest: idOrNull(r.newest),
      writers: r.writers as WriterId[],
      threads: threadsOf(r.threads),
      mentions: r.mentions.map(m => ({
        id: entryId(m.id),
        by: m.by as WriterId,
        text: m.text,
        thread: m.thread,
      })),
      images: r.images as Sha256[],
    })),
}
