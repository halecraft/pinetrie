// roots — the directory of roots (ADR-0063): what your list, the board, the
// inbox and the activity menu read of a root without opening its document.
//
// The record is a host-written `pinetrie.root` value in the session, keyed by
// the root's id. The host refreshes it whenever the root's document changes
// (`readRootRecord`, in `@pinetrie/reads`), so it lags a running turn by one
// step of the host's queue.

import {
  type EntryId,
  entryId,
  isLaneName,
  type LaneName,
  type RootId,
  type RootRecord,
  type Sha256,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, rootKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const Id = Type.String({ minLength: 1 })
const RootRecordSchema = Type.Object({
  entry: Type.Union([Id, Type.Null()]),
  first: Type.Union([Id, Type.Null()]),
  firstLine: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  messages: Type.Number(),
  newest: Type.Union([Id, Type.Null()]),
  writers: Type.Array(Type.String()),
  // Optional: a starting host chooses the roots it opens from these records
  // (`planLoads`), and a record written before the field must still decode.
  threads: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  mentions: Type.Array(
    Type.Object({ id: Id, by: Type.String(), text: Type.String() }),
  ),
  images: Type.Array(Type.String()),
})

const idOrNull = (id: string | null): EntryId | null =>
  id === null ? null : entryId(id)

/** Each thread's writers, a key that is no lane name dropped. */
const threadsOf = (
  threads: Readonly<Record<string, readonly string[]>> | undefined,
): Readonly<Record<LaneName, readonly WriterId[]>> =>
  Object.fromEntries(
    Object.entries(threads ?? {}).flatMap(([lane, writers]) =>
      isLaneName(lane) ? [[lane, writers as WriterId[]]] : [],
    ),
  )

/** Each root's directory record, at its id. */
export const ROOT: RecordSpec<RootRecord, RootId, "session"> = {
  namespace: "pinetrie.root",
  home: "session",
  keyOf: r => r.root,
  encode: ({ root, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(RootRecordSchema, contents, rootKey(key), (r, root) => ({
      root,
      entry: idOrNull(r.entry),
      first: idOrNull(r.first),
      firstLine: r.firstLine,
      title: r.title,
      messages: r.messages,
      newest: idOrNull(r.newest),
      writers: r.writers as WriterId[],
      threads: threadsOf(r.threads),
      mentions: r.mentions.map(m => ({
        id: entryId(m.id),
        by: m.by as WriterId,
        text: m.text,
      })),
      images: r.images as Sha256[],
    })),
}
