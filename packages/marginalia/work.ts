// work — where lanes work, the disk and files at each entry, resolutions,
// offers, what you have of lanes, and lanes' names (ADR-0032 to ADR-0034,
// ADR-0038, ADR-0039).
//
// Host-written records, each a pi value under a `pineta.` namespace.
// `encodeWorkRecord` is the one place their namespaces and keys are chosen;
// each has a total decoder. The decisions an update needs (`planUpdate`,
// `landingOutcome`), what a turn records (`planTurnRecord`), where a fork
// starts (`forkPoint`) and which snapshots go (`planRetention`) are pure,
// over what the host gathers. An offer's own decisions are in `offer.ts`.

import {
  type Above,
  BASE_SNAPSHOT,
  type CommandSummary,
  type CommitId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type ForkStart,
  type HaveRecord,
  HOST_WORKING_COPY,
  isBusy,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type NameRecord,
  type OfferRecord,
  type ProjectRecord,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type ThreadName,
  type WriterId,
  type YoursNow,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

export const LANE_NAMESPACE = "pineta.lane"
export const REVISION_NAMESPACE = "pineta.revision"
export const LANDING_NAMESPACE = "pineta.landing"
export const OFFER_NAMESPACE = "pineta.offer"
export const HAVE_NAMESPACE = "pineta.have"
export const NAME_NAMESPACE = "pineta.name"
export const PROJECT_NAMESPACE = "pineta.project"
/** The one `pineta.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"
export const COMMANDS_NAMESPACE = "pineta.commands"
/** The one `pineta.commands` value's key: what the host's pi loaded. */
export const COMMANDS_KEY = "commands"

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

const CommandSummarySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt")]),
  description: Type.String(),
  argumentHint: Type.Union([Type.String(), Type.Null()]),
})

const CommandsRecordSchema = Type.Object({
  commands: Type.Array(CommandSummarySchema),
})

const LandingRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  state: Type.Union([Type.Literal("resolved"), Type.Literal("needs_you")]),
  by: Type.String(),
  at: Type.Number(),
})

const Commit = Type.String({ minLength: 1 })

const OfferRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 1 }),
  stale: Type.Boolean(),
  files: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  yourEdits: Type.Array(Type.String()),
  described: Type.Boolean(),
  edited: Type.Boolean(),
  bookmark: Type.String({ minLength: 1 }),
  taken: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  at: Type.Number(),
  host: Type.Object({
    changes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    wrote: Type.Array(Commit, { minItems: 1 }),
    tip: Commit,
    start: Type.Array(Commit, { minItems: 1 }),
  }),
})

const NameRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  name: Type.String({ pattern: "^[a-z]+-[a-z]+$" }),
  at: Type.Number(),
})

const HaveRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  commit: Commit,
  kind: Type.Union([Type.Literal("delivered"), Type.Literal("copy")]),
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
    by: r.by as WriterId,
  }))

export const decodeOfferRecord = (value: unknown): OfferRecord | undefined =>
  decodeWith(OfferRecordSchema, value, r => ({
    ...r,
    lane: r.lane as LaneName,
    host: {
      changes: r.host.changes,
      wrote: r.host.wrote.map(commitId),
      tip: commitId(r.host.tip),
      start: r.host.start.map(commitId),
    },
  }))

export const decodeNameRecord = (value: unknown): NameRecord | undefined =>
  decodeWith(NameRecordSchema, value, r => ({
    lane: r.lane as LaneName,
    name: r.name as ThreadName,
    at: r.at,
  }))

export const decodeHaveRecord = (value: unknown): HaveRecord | undefined =>
  decodeWith(HaveRecordSchema, value, r => ({
    ...r,
    lane: r.lane as LaneName,
    commit: commitId(r.commit),
  }))

/** The commands the host's pi loaded, as people see them (ADR-0036). */
export interface CommandsRecord {
  readonly commands: readonly CommandSummary[]
}

export const decodeCommandsRecord = (
  value: unknown,
): CommandsRecord | undefined => decodeWith(CommandsRecordSchema, value, r => r)

/** Any of the host's records, tagged: what the host writes through one method. */
export type WorkRecord =
  | { readonly kind: "lane"; readonly record: LaneRecord }
  | { readonly kind: "revision"; readonly record: RevisionRecord }
  | { readonly kind: "landing"; readonly record: LandingRecord }
  | { readonly kind: "offer"; readonly record: OfferRecord }
  | { readonly kind: "have"; readonly record: HaveRecord }
  | { readonly kind: "name"; readonly record: NameRecord }
  | { readonly kind: "project"; readonly record: ProjectRecord }
  | { readonly kind: "commands"; readonly record: CommandsRecord }

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
    case "offer":
      return {
        namespace: OFFER_NAMESPACE,
        key: r.record.lane,
        value: {
          ...r.record,
          files: [...r.record.files],
          conflicts: [...r.record.conflicts],
          yourEdits: [...r.record.yourEdits],
          host: {
            changes: [...r.record.host.changes],
            wrote: [...r.record.host.wrote],
            tip: r.record.host.tip,
            start: [...r.record.host.start],
          },
        },
      }
    case "have":
      return {
        namespace: HAVE_NAMESPACE,
        key: r.record.commit,
        value: { ...r.record },
      }
    case "name":
      return {
        namespace: NAME_NAMESPACE,
        key: r.record.lane,
        value: { ...r.record },
      }
    case "project":
      return {
        namespace: PROJECT_NAMESPACE,
        key: PROJECT_KEY,
        value: { ...r.record },
      }
    case "commands":
      return {
        namespace: COMMANDS_NAMESPACE,
        key: COMMANDS_KEY,
        value: { commands: r.record.commands.map(c => ({ ...c })) },
      }
  }
}

/**
 * Whether a host-written record's value differs from what is stored: the
 * host writes a record at start only when it changed. A write compacted with
 * no client connected moves the document's base past what a new client
 * reports, so an unchanged record must not be written.
 */
export const recordChanged = (record: WorkRecord, stored: unknown): boolean =>
  JSON.stringify(encodeWorkRecord(record).value) !== JSON.stringify(stored)

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

/** Stored `pineta.offer` values -> each lane's offer, by lane. */
export const offerRecords = (
  values: Stored,
): ReadonlyMap<string, OfferRecord> =>
  new Map(decodeAll(values, decodeOfferRecord).map(r => [r.lane, r]))

/** Stored `pineta.name` values -> each lane's name, by lane (ADR-0039). */
export const nameRecords = (
  values: Stored,
): ReadonlyMap<LaneName, ThreadName> =>
  new Map(decodeAll(values, decodeNameRecord).map(r => [r.lane, r.name]))

/** Stored `pineta.have` values -> every commit you have of lanes. */
export const haveRecords = (values: Stored): readonly HaveRecord[] =>
  decodeAll(values, decodeHaveRecord)

/** The stored `pineta.commands` value's commands; none before a host wrote one. */
export const commandsRecord = (values: Stored): readonly CommandSummary[] =>
  decodeAll(values, decodeCommandsRecord)[0]?.commands ?? []

/** The stored `pineta.project` value, or null before a host with tools wrote one. */
export const projectRecord = (values: Stored): ProjectRecord | null =>
  decodeAll(values, decodeProjectRecord)[0] ?? null

// ── updates ───────────────────────────────────────────────────────────────

/**
 * What an `update` does. Only a lane with its own copy takes your work; a busy
 * lane holds it, as it would a message, which also covers an update or a
 * resolution already running.
 */
export function planUpdate(input: {
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
 * How a resolution run ended. The agent can always stop by asking; it can
 * never claim a success the repository contradicts (ADR-0033).
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
 * Where a new lane of its own starts. With a revision above it: the nearest
 * snapshot above, else the base snapshot, and that revision's commit. With
 * none (a root thread, or a branch above any agent work): the base snapshot,
 * and a copy of your `@` as it is now, made in the lane on `@`'s parents, so
 * the lane sees your uncommitted edits (ADR-0038). Never `@` itself: that
 * commit would come back into your repo with the lane's work and make your
 * `@` divergent (S48 item 10). Either way the fork starts on a commit of its
 * own, because a cloned disk carries its parent's working-copy change, which
 * the fork must leave (S42 item 2).
 */
export const forkPoint = (input: {
  readonly above: Above
  readonly yours: YoursNow
}): {
  readonly snapshot: SnapshotId
  readonly start: ForkStart
} =>
  input.above.commit === null
    ? {
        snapshot: input.above.snapshot ?? BASE_SNAPSHOT,
        start: { kind: "copy", ...input.yours },
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
