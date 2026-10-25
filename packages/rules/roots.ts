// roots — the directory of roots: what the sidebar, the board and your inbox
// read of a root without opening its document.

import {
  type EntryId,
  entryId,
  isSha256,
  isThreadId,
  type RootId,
  type Sha256,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  List,
  recordDecoder,
  rootKey,
  ThreadIdSchema,
  WriterIdSchema,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const Id = Type.String({ minLength: 1 })
const RootRecordSchema = Type.Object({
  entry: Type.Union([Id, Type.Null()]),
  first: Type.Union([Id, Type.Null()]),
  firstLine: Type.String(),
  messages: Type.Number(),
  newest: Type.Union([Id, Type.Null()]),
  writers: List(WriterIdSchema),
  threads: Type.Record(Type.String(), List(WriterIdSchema)),
  mentions: List(
    Type.Object({
      id: Id,
      by: WriterIdSchema,
      text: Type.String(),
      thread: ThreadIdSchema,
    }),
  ),
  blobs: List(Type.String()),
})

const idOrNull = (id: string | null): EntryId | null =>
  id === null ? null : entryId(id)

/** Each thread's writers, a key that is no lane name dropped. */
const threadsOf = (
  threads: Readonly<Record<string, readonly WriterId[]>>,
): Readonly<Record<ThreadId, readonly WriterId[]>> =>
  Object.fromEntries(
    Object.entries(threads).flatMap(([lane, writers]) =>
      isThreadId(lane) ? [[lane, writers]] : [],
    ),
  )

/**
 * A root as the sidebar, the board and your inbox see it,
 * without its document: a host-written `pinetrie.root` value in the session,
 * keyed by the root's id, refreshed whenever the root's document changes.
 */
export interface RootRecord {
  readonly root: RootId
  /** Its root entry, the tab's key; null before its first message. */
  readonly entry: EntryId | null
  /** Its first message, as the rail finds it (`RootSummary.first`). */
  readonly first: EntryId | null
  /** That message's first line: the label while it has no title. */
  readonly firstLine: string
  /** Its messages: the rail's rows. */
  readonly messages: number
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId | null
  /** Everyone who wrote a chat in it, in order of first message. */
  readonly writers: readonly WriterId[]
  /**
   * Per thread, everyone who wrote a chat on its path from the root to its tip,
   * in order of first message: its followers.
   */
  readonly threads: Readonly<Record<ThreadId, readonly WriterId[]>>
  /**
   * Its sends that name someone (`@`), for the inbox to resolve, each with the
   * thread it is in, which the inbox opens it in.
   */
  readonly mentions: readonly {
    readonly id: EntryId
    readonly by: WriterId
    readonly text: string
    readonly thread: ThreadId
  }[]
  /** Every blob it shows or shares (`referencedBlobs`), for the sweep. */
  readonly blobs: readonly Sha256[]
}

/**
 * Each root's directory record, at its id. Derived from the root's document
 * alone, so a record that does not decode in this build's shape is rebuilt
 * at a host's start (`host/directory.ts`), never migrated.
 */
export const ROOT: RecordSpec<
  RootRecord,
  RootId,
  "session",
  typeof RootRecordSchema
> = {
  namespace: "pinetrie.root",
  home: "session",
  derived: true,
  keyOf: r => r.root,
  encode: ({ root, ...contents }) => contents,
  decode: recordDecoder(RootRecordSchema, rootKey, (r, root) => ({
    root,
    entry: idOrNull(r.entry),
    first: idOrNull(r.first),
    firstLine: r.firstLine,
    messages: r.messages,
    newest: idOrNull(r.newest),
    writers: r.writers,
    threads: threadsOf(r.threads),
    mentions: r.mentions.map(m => ({
      id: entryId(m.id),
      by: m.by,
      text: m.text,
      thread: m.thread,
    })),
    blobs: r.blobs.filter(isSha256),
  })),
}
