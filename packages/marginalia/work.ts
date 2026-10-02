// work — where lanes work, the disk and files at each entry, resolutions,
// offers, the integration line and threads' bases, and lanes' names
// (ADR-0032 to ADR-0034, ADR-0038, ADR-0039, ADR-0060), and threads' banners.
//
// Host-written records, each a pi value under a `pineta.` namespace.
// `encodeWorkRecord` is the one place their namespaces and keys are chosen;
// each has a total decoder. How a resolution ended
// (`landingOutcome`), what a turn records (`planTurnRecord`), where a fork
// starts (`forkPoint`) and which snapshots go (`planRetention`) are pure,
// over what the host gathers. An offer's own decisions are in `offer.ts`.

import {
  type Above,
  BASE_SNAPSHOT,
  type BannerRecord,
  type BaseRecord,
  type CommandSummary,
  type CommitId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type ForkStart,
  HOST_WORKING_COPY,
  isLaneName,
  isSha256,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LineRecord,
  type NameRecord,
  type OfferRecord,
  type ProjectRecord,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type ThreadBase,
  type ThreadName,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

export const LANE_NAMESPACE = "pineta.lane"
export const REVISION_NAMESPACE = "pineta.revision"
export const LANDING_NAMESPACE = "pineta.landing"
export const OFFER_NAMESPACE = "pineta.offer"
/**
 * Where ADR-0038 kept the commits you had of lanes; ADR-0060's trailers
 * replace them. A starting host deletes what an older one left there.
 */
export const LEGACY_HAVE_NAMESPACE = "pineta.have"
export const LINE_NAMESPACE = "pineta.line"
export const BASE_NAMESPACE = "pineta.base"
const LINE_KEY = "line"
export const NAME_NAMESPACE = "pineta.name"
export const BANNER_NAMESPACE = "pineta.banner"
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
  // Absent in records written before turns recorded their paths (ADR-0056).
  paths: Type.Optional(Type.Array(Type.String())),
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
  commits: Type.Array(Commit),
  at: Type.Number(),
})

const BannerRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  sha: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  at: Type.Number(),
})

const NameRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  name: Type.String({ pattern: "^[a-z]+-[a-z]+$" }),
  at: Type.Number(),
})

const LineRecordSchema = Type.Object({
  onto: Type.String({ minLength: 1 }),
  wipPrefix: Type.String({ minLength: 1 }),
  commit: Type.Union([Commit, Type.Null()]),
  heads: Type.Object({
    current: Type.Union([Type.String(), Type.Null()]),
    proposed: Type.String({ minLength: 1 }),
  }),
  log: Type.Object({
    current: Type.Union([Type.String(), Type.Null()]),
    proposed: Type.String({ minLength: 1 }),
  }),
  wips: Type.Array(
    Type.Object({
      bookmark: Type.String({ minLength: 1 }),
      commit: Commit,
      behind: Type.Integer({ minimum: 0 }),
      ahead: Type.Integer({ minimum: 0 }),
    }),
  ),
  yours: Type.Object({
    behind: Type.Integer({ minimum: 0 }),
    ahead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    follow: Type.Union([
      Type.Object({
        files: Type.Array(Type.String()),
        conflicts: Type.Array(Type.String()),
        heads: Type.Integer({ minimum: 0 }),
      }),
      Type.Null(),
    ]),
    conflicts: Type.Object({
      commits: Type.Integer({ minimum: 0 }),
      files: Type.Array(Type.String()),
    }),
  }),
  commands: Type.Boolean(),
})

const BaseRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  base: Type.Union([
    Type.Object({ kind: Type.Literal("line") }),
    Type.Object({
      kind: Type.Literal("wip"),
      bookmark: Type.String({ minLength: 1 }),
    }),
  ]),
  start: Commit,
  state: Type.Union([
    Type.Literal("ok"),
    Type.Literal("landed"),
    Type.Literal("gone"),
  ]),
})

export const decodeLineRecord = (value: unknown): LineRecord | undefined =>
  decodeWith(LineRecordSchema, value, r => ({
    ...r,
    commit: r.commit === null ? null : commitId(r.commit),
    wips: r.wips.map(w => ({ ...w, commit: commitId(w.commit) })),
  }))

export const decodeBaseRecord = (value: unknown): BaseRecord | undefined =>
  decodeWith(BaseRecordSchema, value, r =>
    isLaneName(r.lane)
      ? { ...r, lane: r.lane, start: commitId(r.start) }
      : undefined,
  )

export const decodeLaneRecord = (value: unknown): LaneRecord | undefined =>
  decodeWith(LaneRecordSchema, value, r =>
    isLaneName(r.lane)
      ? {
          lane: r.lane,
          work: r.work,
          by: r.by as WriterId,
          createdAt: r.createdAt,
        }
      : undefined,
  )

export const decodeRevisionRecord = (
  value: unknown,
): RevisionRecord | undefined =>
  decodeWith(RevisionRecordSchema, value, r =>
    isLaneName(r.lane)
      ? {
          entry: entryId(r.entry),
          lane: r.lane,
          commit: r.commit === null ? null : commitId(r.commit),
          snapshot:
            r.snapshot === undefined || r.snapshot === null
              ? null
              : snapshotId(r.snapshot),
          paths: r.paths ?? [],
        }
      : undefined,
  )

export const decodeProjectRecord = (
  value: unknown,
): ProjectRecord | undefined => decodeWith(ProjectRecordSchema, value, r => r)

export const decodeLandingRecord = (
  value: unknown,
): LandingRecord | undefined =>
  decodeWith(LandingRecordSchema, value, r =>
    isLaneName(r.lane)
      ? {
          ...r,
          lane: r.lane,
          prompt: entryId(r.prompt),
          by: r.by as WriterId,
        }
      : undefined,
  )

export const decodeOfferRecord = (value: unknown): OfferRecord | undefined =>
  decodeWith(OfferRecordSchema, value, r =>
    isLaneName(r.lane)
      ? {
          // Field by field: an older record has a `host` key, what the host
          // once kept for itself, which a spread would carry along.
          lane: r.lane,
          size: r.size,
          stale: r.stale,
          files: r.files,
          conflicts: r.conflicts,
          yourEdits: r.yourEdits,
          described: r.described,
          edited: r.edited,
          bookmark: r.bookmark,
          taken: r.taken,
          commits: r.commits.map(commitId),
          at: r.at,
        }
      : undefined,
  )

export const decodeNameRecord = (value: unknown): NameRecord | undefined =>
  decodeWith(NameRecordSchema, value, r =>
    isLaneName(r.lane)
      ? { lane: r.lane, name: r.name as ThreadName, at: r.at }
      : undefined,
  )

export const decodeBannerRecord = (value: unknown): BannerRecord | undefined =>
  decodeWith(BannerRecordSchema, value, r =>
    isSha256(r.sha) && isLaneName(r.lane)
      ? { lane: r.lane, sha: r.sha, at: r.at }
      : undefined,
  )

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
  | { readonly kind: "line"; readonly record: LineRecord }
  | { readonly kind: "base"; readonly record: BaseRecord }
  | { readonly kind: "name"; readonly record: NameRecord }
  | { readonly kind: "banner"; readonly record: BannerRecord }
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
        value: { ...r.record, paths: [...r.record.paths] },
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
          commits: [...r.record.commits],
        },
      }
    case "line":
      return {
        namespace: LINE_NAMESPACE,
        key: LINE_KEY,
        value: {
          ...r.record,
          heads: { ...r.record.heads },
          log: { ...r.record.log },
          wips: r.record.wips.map(w => ({ ...w })),
          yours: {
            ...r.record.yours,
            follow:
              r.record.yours.follow === null
                ? null
                : {
                    ...r.record.yours.follow,
                    files: [...r.record.yours.follow.files],
                    conflicts: [...r.record.yours.follow.conflicts],
                  },
            conflicts: {
              ...r.record.yours.conflicts,
              files: [...r.record.yours.conflicts.files],
            },
          },
        },
      }
    case "base":
      return {
        namespace: BASE_NAMESPACE,
        key: r.record.lane,
        value: { ...r.record, base: { ...r.record.base } },
      }
    case "name":
      return {
        namespace: NAME_NAMESPACE,
        key: r.record.lane,
        value: { ...r.record },
      }
    case "banner":
      return {
        namespace: BANNER_NAMESPACE,
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
export const laneRecords = (
  values: Stored,
): ReadonlyMap<LaneName, LaneRecord> =>
  new Map(decodeAll(values, decodeLaneRecord).map(r => [r.lane, r]))

/** Stored `pineta.revision` values -> each record, by the entry it is at. */
export const revisionRecords = (
  values: Stored,
): ReadonlyMap<EntryId, RevisionRecord> =>
  new Map(decodeAll(values, decodeRevisionRecord).map(r => [r.entry, r]))

/** Stored `pineta.landing` values -> every landing, oldest first (ids are uuidv7). */
export const landingRecords = (values: Stored): readonly LandingRecord[] =>
  decodeAll(values, decodeLandingRecord).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

/** Stored `pineta.offer` values -> each lane's offer, by lane. */
export const offerRecords = (
  values: Stored,
): ReadonlyMap<LaneName, OfferRecord> =>
  new Map(decodeAll(values, decodeOfferRecord).map(r => [r.lane, r]))

/** Stored `pineta.name` values -> each lane's name, by lane (ADR-0039). */
export const nameRecords = (
  values: Stored,
): ReadonlyMap<LaneName, ThreadName> =>
  new Map(decodeAll(values, decodeNameRecord).map(r => [r.lane, r.name]))

/** Stored `pineta.banner` values -> each thread's banner, by lane. */
export const bannerRecords = (
  values: Stored,
): ReadonlyMap<LaneName, BannerRecord> =>
  new Map(decodeAll(values, decodeBannerRecord).map(r => [r.lane, r]))

/** The stored `pineta.line` value, or null before a host wrote one. */
export const lineRecord = (values: Stored): LineRecord | null =>
  decodeAll(values, decodeLineRecord)[0] ?? null

/** Stored `pineta.base` values -> each lane's base, by lane. */
export const baseRecords = (
  values: Stored,
): ReadonlyMap<LaneName, BaseRecord> =>
  new Map(decodeAll(values, decodeBaseRecord).map(r => [r.lane, r]))

/** The stored `pineta.commands` value's commands; none before a host wrote one. */
export const commandsRecord = (values: Stored): readonly CommandSummary[] =>
  decodeAll(values, decodeCommandsRecord)[0]?.commands ?? []

/** The stored `pineta.project` value, or null before a host with tools wrote one. */
export const projectRecord = (values: Stored): ProjectRecord | null =>
  decodeAll(values, decodeProjectRecord)[0] ?? null

// ── resolutions ─────────────────────────────────────────────────────────

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
 * its disk was at even after its base moved. A lane working directly records
 * its prompts only, with neither. Only a turn's own commit carries the paths
 * it changed: a prompt's newest revision is what came before it (ADR-0056).
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
}): RevisionRecord | null {
  const { entry, lane } = input
  if (!input.own)
    return input.isPrompt
      ? { entry, lane, commit: null, snapshot: null, paths: [] }
      : null
  if (!input.isPrompt && !input.toolCalls && input.committed === null)
    return null
  const commit = input.committed ?? (input.isPrompt ? input.newest : null)
  return {
    entry,
    lane,
    commit,
    snapshot: input.snapshot,
    paths: input.committed === null ? [] : input.paths,
  }
}

/** Where agent work begins when nothing is above: the line, or a WIP's copy. */
export type ForkBegin = Extract<ForkStart, { readonly kind: "line" | "wip" }>

/**
 * Where a new lane begins when it has no agent work to inherit (ADR-0060),
 * from the thread's base and what the host read of your repo: the line's
 * commit, or a copy of the WIP on the line commit under it. Refused with no
 * line (`no_line`), and for a base that is not a WIP bookmark above the line
 * (`bad_base`). Pure.
 */
export function planBegin(input: {
  /** The WIP bookmark chosen at the first message; null for the line. */
  readonly base: string | null
  readonly onto: string
  readonly wipPrefix: string
  readonly facts: {
    /** The line's commit; null before it is set up. */
    readonly line: CommitId | null
    /** The WIP's commit and the line commit under it; null when it is no WIP above the line. */
    readonly wip: { readonly commit: CommitId; readonly under: CommitId } | null
  }
}): ForkBegin | ErrCode {
  const { base, facts } = input
  if (facts.line === null) return ERR.NO_LINE
  if (base === null)
    return { kind: "line", onto: input.onto, commit: facts.line }
  if (!base.startsWith(input.wipPrefix) || facts.wip === null)
    return ERR.BAD_BASE
  return { kind: "wip", bookmark: base, ...facts.wip }
}

/** What an update merges into a lane (ADR-0060). */
export type UpdateFrom =
  | { readonly kind: "line"; readonly onto: string; readonly commit: CommitId }
  | {
      readonly kind: "wip"
      readonly bookmark: string
      readonly commit: CommitId
      readonly under: CommitId
    }
  /** The base already holds nothing the lane lacks. */
  | { readonly kind: "nothing" }

/**
 * What bringing a thread up to date merges (ADR-0060): always its base. A
 * lane whose newest `Pineta-Base` names a WIP merges a fresh copy of it,
 * unless that copy is of the WIP's commit now; one on the line, or with none
 * (a lane from before the line), merges the line's commit. A WIP that landed
 * hands the thread to the line; one gone without landing refuses
 * (`base_gone`), until `toLine` ("continue on the line") moves it there.
 * With no line, refused (`no_line`). Pure.
 */
export function planUpdateFrom(input: {
  readonly onto: string
  /** The lane's newest `Pineta-Base`, or null. */
  readonly newest: {
    readonly bookmark: string
    readonly commit: CommitId
  } | null
  /** "continue on the line": the thread moves to the line, whatever its base. */
  readonly toLine: boolean
  readonly line: CommitId | null
  /** For a WIP base: its state, and its commit and the line commit under it now. */
  readonly wip: {
    readonly state: "ok" | "landed" | "gone"
    readonly now: { readonly commit: CommitId; readonly under: CommitId } | null
  } | null
}): UpdateFrom | ErrCode {
  const { newest, wip } = input
  if (input.line === null) return ERR.NO_LINE
  const onWip =
    !input.toLine &&
    newest !== null &&
    newest.bookmark !== input.onto &&
    wip !== null &&
    wip.state !== "landed"
  if (!onWip) return { kind: "line", onto: input.onto, commit: input.line }
  if (wip.state === "gone" || wip.now === null) return ERR.BASE_GONE
  return wip.now.commit === newest.commit
    ? { kind: "nothing" }
    : { kind: "wip", bookmark: newest.bookmark, ...wip.now }
}

/**
 * A thread's base as people read it: the integration line is "the project",
 * whatever its bookmark is called; a WIP is its bookmark. The one place a
 * base is worded: the bookmark of the line goes in titles only.
 */
export const baseName = (base: ThreadBase): string =>
  base.kind === "line" ? "the project" : base.bookmark

/**
 * A WIP base's state (ADR-0060): landed when its bookmark points into the
 * line (moved there, or squashed into the line, which keeps the bookmark and
 * drops the WIP's change, S77 item 2), or, with the bookmark gone, when the
 * commit the lane's `Pineta-Base` names, or its change, is on the line.
 * Gone when the bookmark is gone and the WIP did not land; else ok. Pure.
 */
export function wipState(facts: {
  /** Where the WIP bookmark points now; null when it is gone. */
  readonly bookmark: CommitId | null
  /** The bookmark's commit is in the line's history. */
  readonly bookmarkInLine: boolean
  /** The commit `Pineta-Base` names, or its change, is in the line's history. */
  readonly sourceInLine: boolean
}): "ok" | "landed" | "gone" {
  if (facts.bookmark !== null) return facts.bookmarkInLine ? "landed" : "ok"
  return facts.sourceInLine ? "landed" : "gone"
}

/**
 * Where a new lane of its own starts. With a revision above it: the nearest
 * snapshot above, else the base snapshot, and that revision's commit. With
 * none (a root thread, or a branch above any agent work): the base snapshot,
 * which is the line's, and `begin`: the line, or a WIP's copy (ADR-0060).
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
