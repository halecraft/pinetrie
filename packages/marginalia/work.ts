// work — where lanes work, the disk and files at each entry, resolutions,
// offers, the integration line and threads' bases, and lanes' names
// (ADR-0032 to ADR-0034, ADR-0038, ADR-0039, ADR-0060), and threads' banners.
//
// Host-written records, each a `RecordSpec` (`records.ts`, ADR-0062) under a
// `pineta.` namespace. How a resolution ended
// (`landingOutcome`), what a turn records (`planTurnRecord`), where a fork
// starts (`forkPoint`) and which snapshots go (`planRetention`) are pure,
// over what the host gathers. An offer's own decisions are in `offer.ts`.

import {
  type Above,
  BASE_SNAPSHOT,
  type BannerRecord,
  type BaseMerge,
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
  isRootId,
  isSha256,
  type LandingRecord,
  type LaneBase,
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
import { decodeAt, entryKey, fixedKey, laneKey, textKey } from "./decode.ts"
import type { LandDetails } from "./land.ts"
import { effectiveBase } from "./offer.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pineta.line` value's key: a host follows one line. */
export const LINE_KEY = "line"
/** The one `pineta.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"
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
  root: Type.String({ minLength: 1 }),
  work: Type.Union([WorkSettingSchema, Type.Null()]),
  by: Type.String(),
  createdAt: Type.Number(),
})

const RevisionRecordSchema = Type.Object({
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
  lane: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  state: Type.Union([Type.Literal("resolved"), Type.Literal("needs_you")]),
  by: Type.String(),
  at: Type.Number(),
})

const Commit = Type.String({ minLength: 1 })

const OfferRecordSchema = Type.Object({
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
  sha: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  at: Type.Number(),
})

const NameRecordSchema = Type.Object({
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

/**
 * Each lane's record, written as the lane is created: the root it works in
 * (ADR-0063), and its setting, its own copy or a directory, or null for none.
 */
export const LANE: RecordSpec<LaneRecord, LaneName, "session"> = {
  namespace: "pineta.lane",
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

/** The commit and disk at an entry, and its turn's paths, at the entry. */
export const REVISION: RecordSpec<RevisionRecord, EntryId, "root"> = {
  namespace: "pineta.revision",
  home: "root",
  keyOf: r => r.entry,
  encode: ({ entry, ...contents }) => ({
    ...contents,
    paths: [...contents.paths],
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
          }
        : undefined,
    ),
}

/** How each resolution ended, at its own id. */
export const LANDING: RecordSpec<LandingRecord, string, "session"> = {
  namespace: "pineta.landing",
  home: "session",
  keyOf: r => r.id,
  encode: ({ id, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(LandingRecordSchema, contents, textKey(key), (r, id) =>
      isLaneName(r.lane)
        ? {
            id,
            lane: r.lane,
            prompt: entryId(r.prompt),
            state: r.state,
            by: r.by as WriterId,
            at: r.at,
          }
        : undefined,
    ),
}

/** Each lane's offer in your repo, at the lane. */
export const OFFER: RecordSpec<OfferRecord, LaneName, "session"> = {
  namespace: "pineta.offer",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => ({
    ...contents,
    files: [...contents.files],
    conflicts: [...contents.conflicts],
    yourEdits: [...contents.yourEdits],
    commits: [...contents.commits],
  }),
  // Field by field: an older record has a `host` key, what the host once
  // kept for itself, which a spread would carry along.
  decode: (contents, key) =>
    decodeAt(OfferRecordSchema, contents, laneKey(key), (r, lane) => ({
      lane,
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
    })),
}

/** The integration line, at its one key. */
export const LINE: RecordSpec<LineRecord, typeof LINE_KEY, "session"> = {
  namespace: "pineta.line",
  home: "session",
  keyOf: () => LINE_KEY,
  encode: r => ({
    ...r,
    heads: { ...r.heads },
    log: { ...r.log },
    wips: r.wips.map(w => ({ ...w })),
    yours: {
      ...r.yours,
      follow:
        r.yours.follow === null
          ? null
          : {
              ...r.yours.follow,
              files: [...r.yours.follow.files],
              conflicts: [...r.yours.follow.conflicts],
            },
      conflicts: {
        ...r.yours.conflicts,
        files: [...r.yours.conflicts.files],
      },
    },
  }),
  decode: (contents, key) =>
    decodeAt(LineRecordSchema, contents, fixedKey(LINE_KEY, key), r => ({
      ...r,
      commit: r.commit === null ? null : commitId(r.commit),
      wips: r.wips.map(w => ({ ...w, commit: commitId(w.commit) })),
    })),
}

/** Each lane's base, as its history says it, at the lane. */
export const BASE: RecordSpec<BaseRecord, LaneName, "session"> = {
  namespace: "pineta.base",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => ({
    ...contents,
    base: { ...contents.base },
  }),
  decode: (contents, key) =>
    decodeAt(BaseRecordSchema, contents, laneKey(key), (r, lane) => ({
      lane,
      base: r.base,
      start: commitId(r.start),
      state: r.state,
    })),
}

/** Each thread's name, `word-word`, at its lane (ADR-0039). */
export const NAME: RecordSpec<NameRecord, LaneName, "session"> = {
  namespace: "pineta.name",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(NameRecordSchema, contents, laneKey(key), (r, lane) => ({
      lane,
      name: r.name as ThreadName,
      at: r.at,
    })),
}

/** Each thread's column banner, the image's hash, at its lane. */
export const BANNER: RecordSpec<BannerRecord, LaneName, "session"> = {
  namespace: "pineta.banner",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(BannerRecordSchema, contents, laneKey(key), (r, lane) =>
      isSha256(r.sha) ? { lane, sha: r.sha, at: r.at } : undefined,
    ),
}

/** What the host found where it runs, at its one key. */
export const PROJECT: RecordSpec<ProjectRecord, typeof PROJECT_KEY, "session"> =
  {
    namespace: "pineta.project",
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

/** The commands the host's pi loaded, as people see them (ADR-0036). */
export interface CommandsRecord {
  readonly commands: readonly CommandSummary[]
}

/** What the host's pi loaded, at its one key. */
export const COMMANDS: RecordSpec<
  CommandsRecord,
  typeof COMMANDS_KEY,
  "session"
> = {
  namespace: "pineta.commands",
  home: "session",
  keyOf: () => COMMANDS_KEY,
  encode: r => ({ commands: r.commands.map(c => ({ ...c })) }),
  decode: (contents, key) =>
    decodeAt(
      CommandsRecordSchema,
      contents,
      fixedKey(COMMANDS_KEY, key),
      r => r,
    ),
}

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

/** The record of a resolution run that ended in `lane`, from its land message. */
export const landingRecord = (input: {
  readonly details: Pick<LandDetails, "landing" | "by">
  readonly lane: LaneName
  /** The land message that started it. */
  readonly prompt: EntryId
  readonly askedForGuidance: boolean
  readonly conflictsLeft: number
  readonly now: number
}): LandingRecord => ({
  id: input.details.landing,
  lane: input.lane,
  prompt: input.prompt,
  state: landingOutcome(input),
  by: input.details.by,
  at: input.now,
})

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

/** What an update merges into a lane (ADR-0060), or nothing. */
export type UpdateFrom =
  | BaseMerge
  /** The WIP already holds nothing the lane lacks. */
  | { readonly kind: "nothing" }

/** Why an update is refused: no line, or a WIP gone without landing. */
export type UpdateRefusal = typeof ERR.NO_LINE | typeof ERR.BASE_GONE

/**
 * What bringing a thread up to date merges (ADR-0060): the base the thread
 * follows (`effectiveBase`), so the button that names it names what is
 * merged. A WIP thread merges a fresh copy of its WIP, on the lane's
 * previous copy, unless the lane's base already names the WIP's commit now. A
 * line thread, a lane with no base, and a landed WIP merge the line's commit.
 * A WIP gone without landing refuses (`base_gone`) until `toLine` ("continue
 * on the line") moves the thread to the line, marking the move even when
 * nothing is merged. With no line, refused (`no_line`). Pure.
 */
export function planUpdateFrom(input: {
  readonly onto: string
  /** The lane's base, from its own history; null for a lane with none, on the line. */
  readonly base: LaneBase | null
  /** `wipState` of a WIP base; "ok" for the line. */
  readonly state: BaseRecord["state"]
  /** "continue on the line": the thread moves to the line, whatever its base. */
  readonly toLine: boolean
  readonly line: CommitId | null
  /** For a WIP base: its commit now and the line commit under it (`beginFacts`). */
  readonly wipNow: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}): UpdateFrom | UpdateRefusal {
  const { base, state, wipNow } = input
  if (input.line === null) return ERR.NO_LINE
  if (!input.toLine && state === "gone") return ERR.BASE_GONE
  const followed: ThreadBase = input.toLine
    ? { kind: "line" }
    : effectiveBase({ base: base?.base ?? { kind: "line" }, state })
  if (followed.kind === "line")
    return {
      kind: "line",
      onto: input.onto,
      commit: input.line,
      mark: input.toLine && base?.base.kind === "wip",
    }
  if (base === null || wipNow === null) return ERR.BASE_GONE
  return wipNow.commit === base.source
    ? { kind: "nothing" }
    : { kind: "wip", bookmark: followed.bookmark, ...wipNow, on: base.start }
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
 * Gone when the bookmark is gone and the WIP did not land; else ok. No
 * facts, a base on the line, is ok. Pure.
 */
export function wipState(
  facts: {
    /** Where the WIP bookmark points now; null when it is gone. */
    readonly bookmark: CommitId | null
    /** The bookmark's commit is in the line's history. */
    readonly bookmarkInLine: boolean
    /** The commit `Pineta-Base` names, or its change, is in the line's history. */
    readonly sourceInLine: boolean
  } | null,
): BaseRecord["state"] {
  if (facts === null) return "ok"
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
