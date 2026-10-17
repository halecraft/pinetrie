// folder-records — a folder project's history as the session stores it:
// each state with its parents, and each conflict a merge into a lane left.

import {
  type AcceptJournal,
  type ConflictRecord,
  type FolderStamp,
  isThreadId,
  type StateRecord,
  type ThreadId,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  decodeAt,
  decodeWith,
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
  Type.Object({
    kind: Type.Literal("concurrent"),
    path: Type.String({ minLength: 1 }),
  }),
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

const InodeSchema = Type.Object({
  ino: Type.Integer({ minimum: 0 }),
  size: Type.Integer({ minimum: 0 }),
  mtimeNs: Type.String({ pattern: "^[0-9]+$" }),
})

const AcceptJournalSchema = Type.Object({
  lane: ThreadIdSchema,
  record: Type.Object({ id: PointSchema, ...StateSchema.properties }),
  paths: List(
    Type.Object({
      path: Type.String({ minLength: 1 }),
      aside: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      moved: Type.Union([InodeSchema, Type.Null()]),
      staged: Type.Union([InodeSchema, Type.Null()]),
      symlink: Type.Union([Type.String(), Type.Null()]),
      linked: Type.Boolean(),
      keptOn: Type.Union([PointSchema, Type.Null()]),
    }),
  ),
  status: Type.Union([
    Type.Literal("open"),
    Type.Literal("accepted"),
    Type.Literal("put-back"),
  ]),
})

/**
 * Each accept into the project's folder from before its first move until
 * its asides are dealt with: what a host stopped part way finishes or puts
 * back at its next start.
 */
export const ACCEPT_JOURNAL: RecordSpec<AcceptJournal, string, "session"> = {
  namespace: "pinetrie.accept",
  home: "session",
  keyOf: j => j.id,
  encode: ({ id, ...contents }) => JSON.parse(JSON.stringify(contents)),
  decode: (contents, key) =>
    decodeAt(AcceptJournalSchema, contents, textKey(key), (r, id) => ({
      id,
      lane: r.lane,
      record: r.record,
      paths: r.paths,
      status: r.status,
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

const FolderStampsSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Object({
    kind: Type.Union([Type.Literal("file"), Type.Literal("symlink")]),
    size: Type.Integer({ minimum: 0 }),
    ctimeNs: Type.String({ pattern: "^[0-9]+$" }),
    exec: Type.Boolean(),
    target: Type.Optional(Type.String()),
  }),
)

/** The project's folder's stamps of its last read as the session's file stores them. */
export const encodeFolderStamps = (
  stamps: ReadonlyMap<string, FolderStamp>,
): string => JSON.stringify(Object.fromEntries(stamps))

/** The stored stamps back; null for a file that is not one, which a read then treats as none. */
export const decodeFolderStamps = (
  text: string,
): ReadonlyMap<string, FolderStamp> | null => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  return (
    decodeWith(
      FolderStampsSchema,
      value,
      r => new Map(Object.entries(r)) as ReadonlyMap<string, FolderStamp>,
    ) ?? null
  )
}
