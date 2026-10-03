// roots — the directory of roots (ADR-0063): what the tabs, the Archive tab,
// the inbox and the header read of a root without opening its document.
//
// The record is a host-written `pineta.root` value in the session, keyed by
// the root's id. The host refreshes it whenever the root's document changes
// (`readRootRecord`, in `@pineta/reads`), so it lags a running turn by one
// step of the host's queue.

import {
  type EntryId,
  entryId,
  type RootId,
  type RootRecord,
  type Sha256,
  type WriterId,
} from "@pineta/core"
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
  mentions: Type.Array(
    Type.Object({ id: Id, by: Type.String(), text: Type.String() }),
  ),
  images: Type.Array(Type.String()),
})

const idOrNull = (id: string | null): EntryId | null =>
  id === null ? null : entryId(id)

/** Each root's directory record, at its id. */
export const ROOT: RecordSpec<RootRecord, RootId, "session"> = {
  namespace: "pineta.root",
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
      mentions: r.mentions.map(m => ({
        id: entryId(m.id),
        by: m.by as WriterId,
        text: m.text,
      })),
      images: r.images as Sha256[],
    })),
}
