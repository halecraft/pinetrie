// work — where lanes work (ADR-0032 to ADR-0034): each lane's setting
// (`pinetrie.lane`), the commit and disk at each entry (`pinetrie.revision`), and
// what the host found where it runs (`pinetrie.project`). What a turn records
// (`planTurnRecord`), where a fork starts (`forkPoint`), which snapshots go
// (`planRetention`) and how a message names your working copy in a lane
// (`showHostWorkingCopy`) are pure, over what the host gathers.

import {
  type Above,
  BASE_SNAPSHOT,
  type CommitId,
  commitId,
  type EntryId,
  type ForkStart,
  HOST_WORKING_COPY,
  isLaneName,
  isRootId,
  type LaneName,
  type LaneRecord,
  type ProjectRecord,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import type { ForkBegin } from "./base.ts"
import {
  CommitSchema,
  decodeAt,
  entryKey,
  fixedKey,
  laneKey,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"

const WorkSettingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("own") }),
  Type.Object({
    kind: Type.Literal("direct"),
    dir: Type.String({ minLength: 1 }),
  }),
])

const LaneRecordSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  work: Type.Union([WorkSettingSchema, Type.Null()]),
  by: Type.String(),
  createdAt: Type.Number(),
})

const RevisionRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  commit: Type.Union([CommitSchema, Type.Null()]),
  // Absent in records written before lane containers.
  snapshot: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  // Absent in records written before turns recorded their paths (ADR-0106).
  paths: Type.Optional(Type.Array(Type.String())),
  // Absent in records written before they recorded conflicts (ADR-0072).
  conflicts: Type.Optional(Type.Array(Type.String())),
})

const ProjectRecordSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("lanes"),
    root: Type.String({ minLength: 1 }),
    rootDefault: Type.Union([Type.Literal("own"), Type.Literal("direct")]),
  }),
  Type.Object({
    kind: Type.Literal("direct"),
    root: Type.String({ minLength: 1 }),
    reason: Type.String(),
  }),
])

/**
 * Each lane's record, written as the lane is created: the root it works in
 * (ADR-0063), and its setting, its own copy or a directory, or null for none.
 */
export const LANE: RecordSpec<LaneRecord, LaneName, "session"> = {
  namespace: "pinetrie.lane",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(LaneRecordSchema, contents, laneKey(key), (r, lane) =>
      isRootId(r.root)
        ? {
            lane,
            root: r.root,
            work: r.work,
            by: r.by as WriterId,
            createdAt: r.createdAt,
          }
        : undefined,
    ),
}

/** The commit and disk at an entry, and its turn's paths and conflicts, at the entry. */
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
    decodeAt(RevisionRecordSchema, contents, entryKey(key), (r, entry) =>
      isLaneName(r.lane)
        ? {
            entry,
            lane: r.lane,
            commit: r.commit === null ? null : commitId(r.commit),
            snapshot:
              r.snapshot === undefined || r.snapshot === null
                ? null
                : snapshotId(r.snapshot),
            paths: r.paths ?? [],
            conflicts: r.conflicts ?? [],
          }
        : undefined,
    ),
}

/** What the host found where it runs, at its one key. */
export const PROJECT: RecordSpec<ProjectRecord, typeof PROJECT_KEY, "session"> =
  {
    namespace: "pinetrie.project",
    home: "session",
    keyOf: () => PROJECT_KEY,
    encode: r => ({ ...r }),
    decode: (contents, key) =>
      decodeAt(
        ProjectRecordSchema,
        contents,
        fixedKey(PROJECT_KEY, key),
        r => r,
      ),
  }

// ── turns and forks ────────────────────────────────────────────────────────

/**
 * What a turn records. A lane of its own records every prompt and every turn
 * that made tool calls, since ignored files change without a commit: its
 * snapshot, and a commit when one was made. A prompt with nothing to commit
 * records the lane's newest revision, so a branch from it names the commit
 * its disk was at even after its base moved. A lane working directly records
 * its prompts only, with neither. Only a turn's own commit carries the paths
 * it changed: a prompt's newest revision is what came before it (ADR-0106).
 * Every record with a commit carries that commit's conflicts, so a branch
 * from any of them knows its copy's (ADR-0072). A turn whose `catch_up`
 * merged (ADR-0080) records the lane's newest revision, which the merge is,
 * with no paths: a branch from it starts with the merged files.
 */
export function planTurnRecord(input: {
  readonly entry: EntryId
  readonly lane: LaneName
  readonly isPrompt: boolean
  /** The message made tool calls. */
  readonly toolCalls: boolean
  readonly own: boolean
  /** The turn's revision from `commitTurn`, made or adopted; null when it has none. */
  readonly committed: CommitId | null
  /** The lane's newest revision before this turn. */
  readonly newest: CommitId | null
  /** The turn's snapshot, or null when it failed. */
  readonly snapshot: SnapshotId | null
  /** The paths `committed` changed (`changedPaths`); none without one. */
  readonly paths: readonly string[]
  /** The files conflicted in the commit the record names: `committed`, else `newest`. */
  readonly conflicts: readonly string[]
  /**
   * The turn merged into the lane (`turnMerged`, ADR-0080): its `catch_up`
   * moved the bookmark, so with no commit of its own the turn names it.
   */
  readonly merged: boolean
}): RevisionRecord | null {
  const { entry, lane } = input
  if (!input.own)
    return input.isPrompt
      ? { entry, lane, commit: null, snapshot: null, paths: [], conflicts: [] }
      : null
  if (!input.isPrompt && !input.toolCalls && input.committed === null)
    return null
  const commit =
    input.committed ?? (input.isPrompt || input.merged ? input.newest : null)
  return {
    entry,
    lane,
    commit,
    snapshot: input.snapshot,
    paths: input.committed === null ? [] : input.paths,
    conflicts: commit === null ? [] : input.conflicts,
  }
}

/**
 * Where a new lane of its own starts. With a revision above it: the nearest
 * snapshot above, else the base snapshot, and that revision's commit. With
 * none (a root thread, or a branch above any agent work): the base snapshot,
 * which is accepted work's, and `begin`: accepted work, or a WIP's copy (ADR-0104).
 * Either way the fork starts on a commit of its own, because a cloned disk
 * carries its parent's working-copy change, which the fork must leave (S42
 * item 2).
 */
export const forkPoint = (input: {
  readonly above: Above
  readonly begin: ForkBegin
}): {
  readonly snapshot: SnapshotId
  readonly start: ForkStart
} =>
  input.above.commit === null
    ? {
        snapshot: input.above.snapshot ?? BASE_SNAPSHOT,
        start: input.begin,
      }
    : {
        snapshot: input.above.snapshot ?? BASE_SNAPSHOT,
        start: { kind: "commits", commits: [input.above.commit] },
      }

/**
 * The snapshots to delete. An open root keeps every one: any visible turn can
 * be branched from. An archived root keeps each lane's newest, which
 * restoring it clones. Entry ids are uuidv7, so the greatest is the newest.
 * The base snapshot is never deleted.
 */
export function planRetention(input: {
  /** The revision records of the root's lanes. */
  readonly records: Iterable<RevisionRecord>
  readonly archived: boolean
}): readonly SnapshotId[] {
  if (!input.archived) return []
  const newest = new Map<LaneName, SnapshotId>()
  const all: SnapshotId[] = []
  for (const r of input.records) {
    if (r.snapshot === null || r.snapshot === BASE_SNAPSHOT) continue
    all.push(r.snapshot)
    const kept = newest.get(r.lane)
    if (kept === undefined || r.snapshot > kept) newest.set(r.lane, r.snapshot)
  }
  const keep = new Set(newest.values())
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
