// work — where lanes work: each lane's setting, the state and disk at each
// entry, and what the host found where it runs.

import {
  BASE_SNAPSHOT,
  type EntryId,
  type ForeignLane,
  type ForkStart,
  HOST_WORKING_COPY,
  isRootId,
  isThreadId,
  type LaneRecord,
  type OwnLane,
  type PointId,
  type ProjectKind,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import {
  type Above,
  messageToolCalls,
  runPrompt,
  type TreeIndex,
  turnEntry,
  turnMerged,
} from "@pinetrie/threads"
import { Type } from "typebox"
import type { ForkBegin } from "./base.ts"
import {
  decodeRecord,
  entryKey,
  fixedKey,
  PointSchema,
  threadKey,
  WriterIdSchema,
} from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"

/** The one `pinetrie.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"

const ProjectKindSchema = Type.Union([
  Type.Literal("jj"),
  Type.Literal("folder"),
])

const LaneRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  history: Type.Union([ProjectKindSchema, Type.Null()]),
  by: Type.String(),
  createdAt: Type.Number(),
})

const ListedSchema = Type.Object({
  paths: Type.Array(Type.String()),
  more: Type.Integer({ minimum: 0 }),
})

const TurnDiskSchema = Type.Object({
  derived: ListedSchema,
  private: ListedSchema,
  unignored: Type.Array(Type.String()),
  leftovers: Type.Array(Type.String()),
  shared: Type.Object({
    wrote: Type.Array(
      Type.Object({
        path: Type.String(),
        version: Type.Integer({ minimum: 1 }),
        concurrent: Type.Boolean(),
      }),
    ),
  }),
})

const RevisionRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  point: Type.Union([PointSchema, Type.Null()]),
  snapshot: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  paths: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  disk: Type.Union([TurnDiskSchema, Type.Null()]),
})

const ProjectRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  kind: ProjectKindSchema,
  owner: Type.Union([WriterIdSchema, Type.Null()]),
})

/**
 * Each lane's record, written as the lane is created: the root it works in,
 * and the kind of history its own copy keeps, null for none.
 */
export const LANE: RecordSpec<LaneRecord, ThreadId, "session"> = {
  namespace: "pinetrie.lane",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(LaneRecordSchema, contents, threadKey(key), (r, lane) =>
      isRootId(r.root)
        ? {
            lane,
            root: r.root,
            history: r.history,
            by: r.by as WriterId,
            createdAt: r.createdAt,
          }
        : undefined,
    ),
}

/** The state and disk at an entry, and its turn's paths and conflicts, at the entry. */
export const REVISION: RecordSpec<RevisionRecord, EntryId, "root"> = {
  namespace: "pinetrie.revision",
  home: "root",
  keyOf: r => r.entry,
  encode: ({ entry, ...contents }) => ({
    ...contents,
    paths: [...contents.paths],
    conflicts: [...contents.conflicts],
  }),
  decode: (contents, key) =>
    decodeRecord(RevisionRecordSchema, contents, entryKey(key), (r, entry) =>
      isThreadId(r.lane)
        ? {
            entry,
            lane: r.lane,
            point: r.point,
            snapshot: r.snapshot === null ? null : snapshotId(r.snapshot),
            paths: r.paths,
            conflicts: r.conflicts,
            disk: r.disk,
          }
        : undefined,
    ),
}

/**
 * What the host found where it runs: a host-written `pinetrie.project` value,
 * rewritten at every start, and only by a host with tools, whose every lane has
 * its own copy.
 */
export interface ProjectRecord {
  readonly root: string
  /** What the project's folder was at this start: what a lane's history must be to run. */
  readonly kind: ProjectKind
  /**
   * Whom the host's config names its owner (`owner`): who answers when
   * a lane asks for their ssh identity. Null with none.
   */
  readonly owner: WriterId | null
}

/** What the host found where it runs, at its one key. */
export const PROJECT: RecordSpec<ProjectRecord, typeof PROJECT_KEY, "session"> =
  {
    namespace: "pinetrie.project",
    home: "session",
    keyOf: () => PROJECT_KEY,
    encode: r => ({ ...r }),
    decode: (contents, key) =>
      decodeRecord(
        ProjectRecordSchema,
        contents,
        fixedKey(PROJECT_KEY, key),
        r => ({ root: r.root, kind: r.kind, owner: r.owner }),
      ),
  }

// ── turns and forks ────────────────────────────────────────────────────────

declare const turnBrand: unique symbol
/**
 * A turn of a lane of its own, to commit: its entry, what kind of turn it
 * is, and its snapshot. Only `planTurn` makes one, so a revision is planned
 * only for a turn it read from the tree.
 */
interface TurnToCommit {
  readonly kind: "commit"
  readonly entry: EntryId
  readonly lane: ThreadId
  readonly isPrompt: boolean
  readonly toolCalls: boolean
  readonly merged: boolean
  readonly snapshot: SnapshotId
  readonly [turnBrand]: true
}

/**
 * What a turn ending at `tip` comes to, read from its root's tree: for a
 * lane with no copy of its own, its revision (a prompt's) or none; for one
 * of its own, the turn to commit, whose revision `planTurnRevision` plans
 * from what the commit made. A `catch_up` in the turn moved the lane: read
 * from the tree (`turnMerged`), so a restart before the record changes
 * nothing.
 */
export function planTurn(facts: {
  readonly index: TreeIndex
  readonly tip: EntryId
  readonly lane: ThreadId
  readonly own: boolean
}):
  | { readonly kind: "none" }
  /** A lane with no copy of its own records no snapshot. */
  | {
      readonly kind: "record"
      readonly revision: RevisionRecord & { readonly snapshot: null }
    }
  | TurnToCommit {
  const { index, lane } = facts
  const entry = turnEntry(index, facts.tip)
  const isPrompt = runPrompt(index, entry) === entry
  const toolCalls = messageToolCalls(index.entries[entry]?.message).length > 0
  if (!facts.own) {
    const revision = planTurnRecord({
      entry,
      lane,
      isPrompt,
      toolCalls,
      own: false,
      committed: null,
      newest: null,
      snapshot: null,
      paths: [],
      conflicts: [],
      merged: false,
    })
    return revision === null
      ? { kind: "none" }
      : { kind: "record", revision: { ...revision, snapshot: null } }
  }
  return {
    kind: "commit",
    entry,
    lane,
    isPrompt,
    toolCalls,
    merged: turnMerged(index, facts.tip),
    snapshot: snapshotId(entry),
  } as TurnToCommit
}

/**
 * The revision a committed turn records (`planTurnRecord`), from what its
 * commit made; null for one with nothing to record.
 */
export const planTurnRevision = (
  turn: TurnToCommit,
  made: {
    readonly committed: PointId | null
    readonly newest: PointId | null
    readonly paths: readonly string[]
    readonly conflicts: readonly string[]
  },
): RevisionRecord | null =>
  planTurnRecord({
    entry: turn.entry,
    lane: turn.lane,
    isPrompt: turn.isPrompt,
    toolCalls: turn.toolCalls,
    own: true,
    snapshot: turn.snapshot,
    merged: turn.merged,
    ...made,
  })

/**
 * What a turn records. A lane of its own records every prompt and every turn
 * that made tool calls, since ignored files change without a new state: its
 * snapshot, and a state when one was made. A prompt with nothing to record
 * names the lane's newest state, so a branch from it names the state its
 * disk was at even after its base moved. A lane with no copy of its own
 * records its prompts only, with neither. Only a turn's own state carries
 * the paths it changed: a prompt's newest state is what came before it.
 * Every record with a state carries that state's conflicts, so a branch
 * from any of them knows its copy's. A turn whose `catch_up`
 * merged records the lane's newest state, which the merge is,
 * with no paths: a branch from it starts with the merged files.
 */
export function planTurnRecord(input: {
  readonly entry: EntryId
  readonly lane: ThreadId
  readonly isPrompt: boolean
  /** The message made tool calls. */
  readonly toolCalls: boolean
  readonly own: boolean
  /** The turn's state (`TurnMade.committed`); null when it has none. */
  readonly committed: PointId | null
  /** The lane's newest state before this turn. */
  readonly newest: PointId | null
  /** The turn's snapshot, or null when it failed. */
  readonly snapshot: SnapshotId | null
  /** The paths `committed` changed (`changedPaths`); none without one. */
  readonly paths: readonly string[]
  /** The files conflicted at the state the record names: `committed`, else `newest`. */
  readonly conflicts: readonly string[]
  /**
   * The turn merged into the lane (`turnMerged`): its `catch_up`
   * moved the lane, so with no state of its own the turn names it.
   */
  readonly merged: boolean
}): RevisionRecord | null {
  const { entry, lane } = input
  if (!input.own)
    return input.isPrompt
      ? {
          entry,
          lane,
          point: null,
          snapshot: null,
          paths: [],
          conflicts: [],
          disk: null,
        }
      : null
  if (!input.isPrompt && !input.toolCalls && input.committed === null)
    return null
  const point =
    input.committed ?? (input.isPrompt || input.merged ? input.newest : null)
  return {
    entry,
    lane,
    point,
    snapshot: input.snapshot,
    paths: input.committed === null ? [] : input.paths,
    conflicts: point === null ? [] : input.conflicts,
    // The turn's classes and diff fill it in once its snapshot is taken.
    disk: null,
  }
}

/**
 * The kind of history of the disk a fork at `above` clones: the lane's whose
 * snapshot it is, or, from the base snapshot (none above, or one not kept),
 * the project's. A new lane's history is this, and a send that would fork
 * there runs on it. A snapshot is only made by a lane with a copy of its
 * own; one whose record is missing is read as the project's.
 */
export function sourceHistory(input: {
  readonly above: Pick<Above, "snapshot" | "snapshotLane">
  /** Whether the snapshot above is still there (`forkSource`'s `kept`). */
  readonly kept: boolean
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  readonly kind: ProjectKind
}): ProjectKind {
  const { snapshot, snapshotLane } = input.above
  if (snapshot === null || snapshotLane === null || !input.kept)
    return input.kind
  return input.lanes.get(snapshotLane)?.history ?? input.kind
}

/** Where a fork starts: the snapshot it clones and the state it starts on. */
interface ForkSource {
  readonly kind: "source"
  readonly snapshot: SnapshotId
  readonly start: ForkStart
  /** The snapshot it should have cloned and could not: gone. Null when its files were kept. */
  readonly lost: SnapshotId | null
}

/**
 * Where `lane`, a new lane of its own, starts. With a revision above it: the
 * nearest snapshot above, else the base snapshot, and that revision's state.
 * With none (a root thread, or a branch above any agent work): the base
 * snapshot, which is accepted work's, and `begin`: accepted work, or a WIP's
 * copy. Either way the fork starts on a commit of its own, because a cloned
 * disk carries its parent's working-copy change, which the fork must leave.
 * Refused (`ForeignLane`) when the disk it would clone is not of `lane`'s
 * kind (`sourceHistory`), as when the records above moved since `lane`'s
 * record was written: a lane never holds a disk of another kind.
 */
export function forkSource(input: {
  readonly above: Above
  readonly begin: ForkBegin
  /**
   * Whether the snapshot above is still there. Archiving deletes snapshots
   * its revision records still name (`planRetention`), so one that is gone
   * is read as missing: the fork starts from its base.
   */
  readonly kept: boolean
  /** The new lane's record, its history decided when it was written. */
  readonly lane: OwnLane
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
  readonly kind: ProjectKind
}): ForkSource | ForeignLane {
  const { above } = input
  const history = sourceHistory(input)
  if (history !== input.lane.history)
    return { kind: "foreign", lane: input.lane.lane, history }
  if (above.snapshot !== null && !input.kept)
    return {
      kind: "source",
      snapshot: BASE_SNAPSHOT,
      start: input.begin,
      lost: above.snapshot,
    }
  return above.point === null
    ? {
        kind: "source",
        snapshot: above.snapshot ?? BASE_SNAPSHOT,
        start: input.begin,
        lost: null,
      }
    : {
        kind: "source",
        snapshot: above.snapshot ?? BASE_SNAPSHOT,
        start: { kind: "recorded", points: [above.point] },
        lost: null,
      }
}

/**
 * A lane's fork: owed from the send until the fork's last step, then
 * begun. A start forks a lane owed, so a fork a host stopped part way runs
 * again from the top; outside its disk, nothing else says a jj lane's setup
 * ran.
 */
export type LaneForkRecord = {
  readonly lane: ThreadId
  /** The WIP bookmark it starts from; null for accepted work. */
  readonly base: string | null
} & (
  | { readonly state: "owed" }
  | {
      readonly state: "begun"
      /** The snapshot its source would have cloned, when that was not kept: its fork row says so. */
      readonly lost: SnapshotId | null
    }
)

const LaneForkSchema = Type.Union([
  Type.Object({
    state: Type.Literal("owed"),
    base: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  }),
  Type.Object({
    state: Type.Literal("begun"),
    base: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    lost: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  }),
])

/** Each lane of its own's fork, at the lane. */
export const LANE_FORK: RecordSpec<LaneForkRecord, ThreadId, "session"> = {
  namespace: "pinetrie.lane-fork",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(LaneForkSchema, contents, threadKey(key), (r, lane) =>
      r.state === "owed"
        ? { lane, base: r.base, state: "owed" }
        : {
            lane,
            base: r.base,
            state: "begun",
            lost: r.lost === null ? null : snapshotId(r.lost),
          },
    ),
}

/**
 * What a fork writes before it runs: a fork run again (its record `begun`)
 * is owed until its end, like the first.
 */
export const planForkRedo = (
  fork: LaneForkRecord,
): readonly ValueWrite<"session">[] =>
  fork.state === "begun"
    ? [
        setRecord(LANE_FORK, {
          lane: fork.lane,
          base: fork.base,
          state: "owed",
        }),
      ]
    : []

/**
 * What a fork writes at its end, in one write: the history's start records
 * (an adapter's), then the fork begun, carrying the snapshot it lost.
 */
export const planForkEnd = (input: {
  readonly fork: LaneForkRecord
  readonly lost: SnapshotId | null
  readonly start: { readonly writes: readonly ValueWrite<"session">[] }
}): readonly ValueWrite<"session">[] => [
  ...input.start.writes,
  setRecord(LANE_FORK, {
    lane: input.fork.lane,
    base: input.fork.base,
    state: "begun",
    lost: input.lost,
  }),
]

/**
 * The writes that record a new lane: its `LANE`, and for a lane of its own
 * its fork, owed, in the same write, so no lane of its own is recorded
 * without one.
 */
export const planLaneRecords = (input: {
  readonly record: LaneRecord
  /** The WIP it starts from; null for accepted work. */
  readonly base: string | null
}): Extract<ValueWrite<"session">, { kind: "set" }>[] => [
  setRecord(LANE, input.record),
  ...(input.record.history === null
    ? []
    : [
        setRecord(LANE_FORK, {
          lane: input.record.lane,
          base: input.base,
          state: "owed",
        }),
      ]),
]

/**
 * The snapshots to delete. An open root keeps every one: any visible turn can
 * be branched from. An archived root keeps each lane's newest, which
 * restoring it clones, and `keep`: the one nearest each thread's end, which
 * a copy of it clones. Entry ids are uuidv7, so the greatest is
 * the newest. The base snapshot is never deleted.
 */
export function planRetention(input: {
  /** The revision records of the root's lanes. */
  readonly records: Iterable<RevisionRecord>
  readonly archived: boolean
  /** The snapshots nearest each thread's end (`nearestRevision`). */
  readonly keep: ReadonlySet<SnapshotId>
}): readonly SnapshotId[] {
  if (!input.archived) return []
  const newest = new Map<ThreadId, SnapshotId>()
  const all: SnapshotId[] = []
  for (const r of input.records) {
    if (r.snapshot === null || r.snapshot === BASE_SNAPSHOT) continue
    all.push(r.snapshot)
    const kept = newest.get(r.lane)
    if (kept === undefined || r.snapshot > kept) newest.set(r.lane, r.snapshot)
  }
  const keep = new Set([...newest.values(), ...input.keep])
  return all.filter(s => !keep.has(s))
}

/** Characters that may continue a path segment: a root followed by one is a longer name. */
const PATH_CHAR = /[\p{L}\p{N}._\-~@+]/u

/**
 * `text` with each path under your working copy's `root` shown under
 * `/mnt/host-working-copy`, as every lane sees it. Only a whole path prefix: not preceded by a
 * path character, and followed by `/` or by a character a path segment cannot
 * continue with. A root inside a longer name (`/p/app` for `/p/a`), or inside
 * a longer path (`/x/p` for `/p`), is left alone.
 */
export function showHostWorkingCopy(text: string, root: string): string {
  const from = root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root
  if (from === "" || from === "/") return text
  let out = ""
  let i = 0
  while (i < text.length) {
    const before = text[i - 1]
    const next = text[i + from.length]
    if (
      (before === undefined || !PATH_CHAR.test(before)) &&
      text.startsWith(from, i) &&
      (next === undefined || !PATH_CHAR.test(next))
    ) {
      out += HOST_WORKING_COPY
      i += from.length
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}
