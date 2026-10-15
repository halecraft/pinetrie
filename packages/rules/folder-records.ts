// folder-records — a folder project's history as the session stores it:
// each state with its parents, and each conflict a merge into a lane left.

import {
  type ConflictRecord,
  isThreadId,
  type StateRecord,
  type ThreadId,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  decodeAt,
  EntryIdSchema,
  List,
  PointSchema,
  ThreadIdSchema,
  textKey,
  WriterIdSchema,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const StateMadeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("read") }),
  Type.Object({ kind: Type.Literal("start"), lane: ThreadIdSchema }),
  Type.Object({
    kind: Type.Literal("turn"),
    lane: ThreadIdSchema,
    entry: EntryIdSchema,
  }),
  Type.Object({ kind: Type.Literal("catch-up"), lane: ThreadIdSchema }),
  Type.Object({ kind: Type.Literal("accept"), lane: ThreadIdSchema }),
  Type.Object({ kind: Type.Literal("restore"), of: PointSchema }),
  Type.Object({ kind: Type.Literal("bases-merged") }),
])

const StateSchema = Type.Object({
  parents: List(PointSchema),
  made: StateMadeSchema,
  at: Type.Number(),
  by: Type.Union([WriterIdSchema, Type.Null()]),
})

/** Each state of a folder project's history, by its snapshot's name. */
export const STATE: RecordSpec<StateRecord, StateRecord["id"], "session"> = {
  namespace: "pinetrie.state",
  home: "session",
  keyOf: r => r.id,
  encode: ({ id, ...contents }) => ({
    ...contents,
    parents: [...contents.parents],
    made: { ...contents.made },
  }),
  decode: (contents, key) =>
    decodeAt(StateSchema, contents, textKey(key), (r, id) => ({
      id: id as StateRecord["id"],
      parents: r.parents,
      made: r.made,
      at: r.at,
      by: r.by,
    })),
}

/**
 * A conflict's address: its lane, then its path. A lane's id holds no `:`,
 * so the first one ends it, whatever the path holds.
 */
export const conflictKey = (lane: ThreadId, path: string): string =>
  `${lane}:${path}`

const conflictAddress = (
  key: string,
): { readonly lane: ThreadId; readonly path: string } | undefined => {
  const at = key.indexOf(":")
  const lane = key.slice(0, at)
  const path = key.slice(at + 1)
  return at === -1 || !isThreadId(lane) || path === ""
    ? undefined
    : { lane, path }
}

const ConflictSchema = Type.Object({
  base: PointSchema,
  ours: PointSchema,
  theirs: PointSchema,
})

/** Each path a merge into a folder lane left conflicted. */
export const CONFLICT: RecordSpec<ConflictRecord, string, "session"> = {
  namespace: "pinetrie.conflict",
  home: "session",
  keyOf: r => conflictKey(r.lane, r.path),
  encode: ({ lane, path, ...contents }) => ({ ...contents }),
  decode: (contents, key) =>
    decodeAt(ConflictSchema, contents, conflictAddress(key), (r, at) => ({
      ...at,
      base: r.base,
      ours: r.ours,
      theirs: r.theirs,
    })),
}
