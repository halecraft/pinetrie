// thread — a thread's record (ADR-0117): its root, who started it and when,
// and how it began: a root's first thread, or a fork at an entry, a branch
// or a copy. Where a thread starts and ends is the
// tree's (each entry's `thread`, `firstOf` and `threadEnd` in @pinetrie/core,
// ADR-0125), never a record's.

import {
  entryId,
  isRootId,
  ROOT_ORIGIN,
  type ThreadId,
  type ThreadRecord,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, threadKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const ThreadRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  createdAt: Type.Number(),
  origin: Type.Union([
    Type.Object({ kind: Type.Literal("root") }),
    Type.Object({
      kind: Type.Literal("fork"),
      at: Type.String({ minLength: 1 }),
      how: Type.Union([Type.Literal("branch"), Type.Literal("copy")]),
    }),
  ]),
})

/** Each thread, at its id, in the session. */
export const THREAD: RecordSpec<ThreadRecord, ThreadId, "session"> = {
  namespace: "pinetrie.thread",
  home: "session",
  keyOf: r => r.thread,
  encode: ({ thread, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(ThreadRecordSchema, contents, threadKey(key), (r, thread) => {
      if (!isRootId(r.root)) return undefined
      const { origin } = r
      return {
        thread,
        root: r.root,
        by: r.by as WriterId,
        createdAt: r.createdAt,
        origin:
          origin.kind === "fork"
            ? { kind: "fork", at: entryId(origin.at), how: origin.how }
            : ROOT_ORIGIN,
      }
    }),
}
