// thread — a thread's record (ADR-0117): its root, who started it and when,
// and a copy's fork until it writes. Where a thread starts and ends is the
// tree's (`starts`, `threadEnd` in @pinetrie/core), never a record's.

import {
  entryId,
  isRootId,
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
  fork: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

/** Each thread, at its id, in the session: written with its first message. */
export const THREAD: RecordSpec<ThreadRecord, ThreadId, "session"> = {
  namespace: "pinetrie.thread",
  home: "session",
  keyOf: r => r.thread,
  encode: ({ thread, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(ThreadRecordSchema, contents, threadKey(key), (r, thread) =>
      isRootId(r.root)
        ? {
            thread,
            root: r.root,
            by: r.by as WriterId,
            createdAt: r.createdAt,
            fork: r.fork === null ? null : entryId(r.fork),
          }
        : undefined,
    ),
}
