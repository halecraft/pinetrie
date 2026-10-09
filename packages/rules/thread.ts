// thread — a thread's record (ADR-0117): its root, who started it and when,
// and how it began: started by its first message, or a copy, with its
// source and fork. Where a thread starts and ends is the
// tree's (each entry's `thread`, `firstOf` and `threadEnd` in @pinetrie/core,
// ADR-0125), never a record's.

import {
  entryId,
  isRootId,
  isThreadId,
  STARTED,
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
    Type.Object({ kind: Type.Literal("started") }),
    Type.Object({
      kind: Type.Literal("copy"),
      source: Type.String({ minLength: 1 }),
      fork: Type.String({ minLength: 1 }),
    }),
  ]),
})

/** Each thread, at its id, in the session: written with its first message. */
export const THREAD: RecordSpec<ThreadRecord, ThreadId, "session"> = {
  namespace: "pinetrie.thread",
  home: "session",
  keyOf: r => r.thread,
  encode: ({ thread, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(ThreadRecordSchema, contents, threadKey(key), (r, thread) => {
      if (!isRootId(r.root)) return undefined
      const { origin } = r
      if (origin.kind === "copy" && !isThreadId(origin.source)) return undefined
      return {
        thread,
        root: r.root,
        by: r.by as WriterId,
        createdAt: r.createdAt,
        origin:
          origin.kind === "copy" && isThreadId(origin.source)
            ? {
                kind: "copy",
                source: origin.source,
                fork: entryId(origin.fork),
              }
            : STARTED,
      }
    }),
}
