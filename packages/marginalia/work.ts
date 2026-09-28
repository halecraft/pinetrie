// work — where lanes work, the disk and files at each entry, and landings
// (ADR-0032, ADR-0033, ADR-0034).
//
// Four host-written records, each a pi value under a `pineta.` namespace.
// `encodeWorkRecord` is the one place their namespaces and keys are chosen;
// each has a total decoder. The decisions a landing needs (`planLand`,
// `planTake`, `landingOutcome`), what a turn records (`planTurnRecord`),
// where a fork starts (`forkPoint`) and which snapshots go (`planRetention`)
// are pure, over what the host gathers.

import {
  type Above,
  BASE_SNAPSHOT,
  type CommitId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  isBusy,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type ProjectRecord,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

export const LANE_NAMESPACE = "pineta.lane"
export const REVISION_NAMESPACE = "pineta.revision"
export const LANDING_NAMESPACE = "pineta.landing"
export const PROJECT_NAMESPACE = "pineta.project"
/** The one `pineta.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"

const WorkSettingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("own") }),
  Type.Object({
    kind: Type.Literal("direct"),
    dir: Type.String({ minLength: 1 }),
  }),
])

const LaneRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  work: WorkSettingSchema,
  by: Type.String(),
  createdAt: Type.Number(),
})

const RevisionRecordSchema = Type.Object({
  entry: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  commit: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  // Absent in records written before lane containers.
  snapshot: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
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

const LandingRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  yours: Type.Array(Type.String({ minLength: 1 })),
  result: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("resolved"),
    Type.Literal("needs_you"),
    Type.Literal("taken"),
  ]),
  by: Type.String(),
  at: Type.Number(),
})

export const decodeLaneRecord = (value: unknown): LaneRecord | undefined =>
  decodeWith(LaneRecordSchema, value, r => ({
    lane: r.lane as LaneName,
    work: r.work,
    by: r.by as WriterId,
    createdAt: r.createdAt,
  }))

export const decodeRevisionRecord = (
  value: unknown,
): RevisionRecord | undefined =>
  decodeWith(RevisionRecordSchema, value, r => ({
    entry: entryId(r.entry),
    lane: r.lane as LaneName,
    commit: r.commit === null ? null : commitId(r.commit),
    snapshot:
      r.snapshot === undefined || r.snapshot === null
        ? null
        : snapshotId(r.snapshot),
  }))

export const decodeProjectRecord = (
  value: unknown,
): ProjectRecord | undefined => decodeWith(ProjectRecordSchema, value, r => r)

export const decodeLandingRecord = (
  value: unknown,
): LandingRecord | undefined =>
  decodeWith(LandingRecordSchema, value, r => ({
    ...r,
    lane: r.lane as LaneName,
    prompt: entryId(r.prompt),
    yours: r.yours.map(commitId),
    result: commitId(r.result),
    by: r.by as WriterId,
  }))

/** Any of the four, tagged: what the host writes through one method. */
export type WorkRecord =
  | { readonly kind: "lane"; readonly record: LaneRecord }
  | { readonly kind: "revision"; readonly record: RevisionRecord }
  | { readonly kind: "landing"; readonly record: LandingRecord }
  | { readonly kind: "project"; readonly record: ProjectRecord }

/** A record -> where it is stored and the plain value stored there. */
export function encodeWorkRecord(r: WorkRecord): {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
} {
  switch (r.kind) {
    case "lane":
      return {
        namespace: LANE_NAMESPACE,
        key: r.record.lane,
        value: { ...r.record },
      }
    case "revision":
      return {
        namespace: REVISION_NAMESPACE,
        key: r.record.entry,
        value: { ...r.record },
      }
    case "landing":
      return {
        namespace: LANDING_NAMESPACE,
        key: r.record.id,
        value: { ...r.record },
      }
    case "project":
      return {
        namespace: PROJECT_NAMESPACE,
        key: PROJECT_KEY,
        value: { ...r.record },
      }
  }
}

type Stored = Iterable<{ readonly value: unknown }>

/** Stored `pineta.lane` values -> each lane's record, by lane. */
export const laneRecords = (values: Stored): ReadonlyMap<string, LaneRecord> =>
  new Map(decodeAll(values, decodeLaneRecord).map(r => [r.lane, r]))

/** Stored `pineta.revision` values -> each record, by the entry it is at. */
export const revisionRecords = (
  values: Stored,
): ReadonlyMap<string, RevisionRecord> =>
  new Map(decodeAll(values, decodeRevisionRecord).map(r => [r.entry, r]))

/** Stored `pineta.landing` values -> every landing, oldest first (ids are uuidv7). */
export const landingRecords = (values: Stored): readonly LandingRecord[] =>
  decodeAll(values, decodeLandingRecord).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

/** The stored `pineta.project` value, or null before a host with tools wrote one. */
export const projectRecord = (values: Stored): ProjectRecord | null =>
  decodeAll(values, decodeProjectRecord)[0] ?? null

// ── landing ────────────────────────────────────────────────────────────────

/**
 * What a `land` does. Only a lane with its own copy lands; a busy lane holds
 * it, as it would a message, which also covers a landing already running.
 */
export function planLand(input: {
  readonly record: LaneRecord | undefined
  readonly view: LaneView | undefined
}):
  | { readonly kind: "start" }
  | { readonly kind: "hold"; readonly position: number }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { record, view } = input
  if (record === undefined || view === undefined || record.work.kind !== "own")
    return { kind: "refused", code: ERR.NOT_OWN_COPY }
  return isBusy(view)
    ? { kind: "hold", position: view.waiting }
    : { kind: "start" }
}

/**
 * What a `take` does: only a resolved landing, and only while your `@-` is
 * the one it merged. `jj rebase -r @` moves only `@`, so a commit you made
 * after landing would drop out of `@`'s ancestry.
 */
export function planTake(input: {
  readonly landing: LandingRecord | undefined
  readonly yoursNow: readonly CommitId[]
}):
  | { readonly kind: "take"; readonly result: CommitId }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { landing, yoursNow } = input
  if (landing === undefined || landing.state !== "resolved")
    return { kind: "refused", code: ERR.REFUSED }
  const same =
    landing.yours.length === yoursNow.length &&
    landing.yours.every(c => yoursNow.includes(c))
  return same
    ? { kind: "take", result: landing.result }
    : { kind: "refused", code: ERR.MOVED }
}

/**
 * How a landing ended. The agent can always stop by asking; it can never
 * claim a success the repository contradicts (ADR-0033).
 */
export const landingOutcome = (input: {
  readonly askedForGuidance: boolean
  readonly conflictsLeft: number
}): "resolved" | "needs_you" =>
  input.askedForGuidance || input.conflictsLeft > 0 ? "needs_you" : "resolved"

// ── turns and forks ────────────────────────────────────────────────────────

/**
 * What a turn records. A lane of its own records every prompt and every turn
 * that made tool calls, since ignored files change without a commit: its
 * snapshot, and a commit when one was made. A prompt with nothing to commit
 * records the lane's newest revision, so a branch from it names the commit
 * its disk was at even after your `@-` moved. A lane working directly records
 * its prompts only, with neither.
 */
export function planTurnRecord(input: {
  readonly entry: EntryId
  readonly lane: LaneName
  readonly isPrompt: boolean
  /** The message made tool calls. */
  readonly toolCalls: boolean
  readonly own: boolean
  /** What `commitTurn` committed, or null when nothing changed. */
  readonly committed: CommitId | null
  /** The lane's newest revision before this turn. */
  readonly newest: CommitId | null
  /** The turn's snapshot, or null when it failed. */
  readonly snapshot: SnapshotId | null
}): RevisionRecord | null {
  const { entry, lane } = input
  if (!input.own)
    return input.isPrompt ? { entry, lane, commit: null, snapshot: null } : null
  if (!input.isPrompt && !input.toolCalls && input.committed === null)
    return null
  const commit = input.committed ?? (input.isPrompt ? input.newest : null)
  return { entry, lane, commit, snapshot: input.snapshot }
}

/**
 * Where a new lane of its own starts: the nearest snapshot above it, else the
 * base snapshot; and the nearest commit above it, else your `@-`. The commit
 * is always named, because a cloned disk carries its parent's working-copy
 * change, and the fork's first `jj new` must leave it (S42 item 2). Several
 * commits when your `@` is a merge.
 */
export const forkPoint = (input: {
  readonly above: Above
  readonly yours: readonly CommitId[]
}): {
  readonly snapshot: SnapshotId
  readonly commits: readonly CommitId[]
} => ({
  snapshot: input.above.snapshot ?? BASE_SNAPSHOT,
  commits: input.above.commit === null ? input.yours : [input.above.commit],
})

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

/** Where every lane sees your working copy, read-only (ADR-0034). */
export const YOURS_MOUNT = "/yours"

/** Characters that may continue a path segment: a root followed by one is a longer name. */
const PATH_CHAR = /[\p{L}\p{N}._\-~@+]/u

/**
 * `text` with each path under your working copy's `root` shown under
 * `/yours`, as every lane sees it. Only a whole path prefix: not preceded by a
 * path character, and followed by `/` or by a character a path segment cannot
 * continue with. A root inside a longer name (`/p/app` for `/p/a`), or inside
 * a longer path (`/x/p` for `/p`), is left alone.
 */
export function showYours(text: string, root: string): string {
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
      out += YOURS_MOUNT
      i += from.length
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}
