// line — the integration line and a thread's base on it (ADR-0060,
// ADR-0061, ADR-0072, ADR-0076): the line's and each lane's base's records
// (`pineta.line`, `pineta.base`), the line's record from what the host read
// (`planLineRecord`), whether a `line` command may run (`lineActionState`)
// and why not (`lineRefusal`), the command (`planLineAction`), where a new
// lane begins (`planBegin`), the base a thread follows (`effectiveBase`),
// what catching up with it would do (`catchUpOf`) and merge
// (`planUpdateFrom`), and the thread a lane branched from (`parentNow`,
// `planParentUpdate`).
// A `line` command's steps are `@pineta/repo`'s (`lineSteps`).

import {
  ancestry,
  type BaseMerge,
  type BaseRecord,
  type CatchUpFrom,
  type CommitId,
  commitId,
  conflictsAt,
  type EntryId,
  ERR,
  type ErrCode,
  type ForkStart,
  firstPromptOf,
  forkParent,
  type LaneBase,
  type LaneName,
  type LineAction,
  type LineDecision,
  type LineFacts,
  type LineRecord,
  nearestRevision,
  type ParentThread,
  type RevisionRecord,
  type ThreadBase,
  type ThreadName,
  type TreeIndex,
} from "@pineta/core"
import { Type } from "typebox"
import { CommitSchema, decodeAt, fixedKey, laneKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pineta.line` value's key: a host follows one line. */
export const LINE_KEY = "line"

const LineRecordSchema = Type.Object({
  onto: Type.String({ minLength: 1 }),
  wipPrefix: Type.String({ minLength: 1 }),
  publish: Type.String({ minLength: 1 }),
  commit: Type.Union([CommitSchema, Type.Null()]),
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
      commit: CommitSchema,
      behind: Type.Integer({ minimum: 0 }),
      ahead: Type.Integer({ minimum: 0 }),
    }),
  ),
  published: Type.Object({
    commit: Type.Union([CommitSchema, Type.Null()]),
    behind: Type.Integer({ minimum: 0 }),
    ahead: Type.Integer({ minimum: 0 }),
  }),
  yours: Type.Object({
    behind: Type.Integer({ minimum: 0 }),
    ahead: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    follow: Type.Union([
      Type.Object({
        changes: Type.Integer({ minimum: 0 }),
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
  start: CommitSchema,
  state: Type.Union([
    Type.Literal("ok"),
    Type.Literal("landed"),
    Type.Literal("gone"),
  ]),
  catchUp: Type.Union([
    Type.Object({
      tip: CommitSchema,
      to: CommitSchema,
      files: Type.Array(Type.String()),
    }),
    Type.Null(),
  ]),
  untraced: Type.Array(CommitSchema),
  work: Type.Union([
    Type.Literal("none"),
    Type.Literal("some"),
    Type.Literal("unknown"),
  ]),
})

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
    published: { ...r.published },
    yours: {
      ...r.yours,
      follow:
        r.yours.follow === null
          ? null
          : {
              ...r.yours.follow,
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
      published: {
        ...r.published,
        commit:
          r.published.commit === null ? null : commitId(r.published.commit),
      },
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
    catchUp:
      contents.catchUp === null
        ? null
        : { ...contents.catchUp, files: [...contents.catchUp.files] },
    untraced: [...contents.untraced],
  }),
  decode: (contents, key) =>
    decodeAt(BaseRecordSchema, contents, laneKey(key), (r, lane) => ({
      lane,
      base: r.base,
      start: commitId(r.start),
      state: r.state,
      catchUp:
        r.catchUp === null
          ? null
          : {
              tip: commitId(r.catchUp.tip),
              to: commitId(r.catchUp.to),
              files: r.catchUp.files,
            },
      untraced: r.untraced.map(commitId),
      work: r.work,
    })),
}

/**
 * The line's record, the page's cache, from what the host read of it
 * (ADR-0060): what setting it up would write to your repo's config
 * (`proposed`, `lineProposal`), and whether this host accepts the `line`
 * commands that act on the repo as its owner.
 */
export function planLineRecord(input: {
  readonly facts: LineFacts
  /** The line's bookmark, the WIP prefix and the publish bookmark. */
  readonly line: {
    readonly onto: string
    readonly wipPrefix: string
    readonly publish: string
  }
  readonly proposed: { readonly heads: string; readonly log: string }
  readonly commands: boolean
}): LineRecord {
  const { facts, line, proposed } = input
  return {
    onto: line.onto,
    wipPrefix: line.wipPrefix,
    publish: line.publish,
    commit: facts.commit,
    heads: { current: facts.heads, proposed: proposed.heads },
    log: { current: facts.log, proposed: proposed.log },
    wips: facts.wips,
    published: facts.published,
    yours: facts.yours,
    commands: input.commands,
  }
}

/**
 * The `line` commands that act on the repo as its owner: refused on a host
 * that admits others. Publishing moves a bookmark forward to work already on
 * the line, so anyone admitted may (ADR-0076).
 */
const HOST_ONLY: ReadonlySet<LineAction> = new Set(["setup", "land", "follow"])

/** Whether a `line` command may run now, and if not, why. */
export type LineActionState =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

const OK: LineActionState = { kind: "ok" }
const refused = (code: ErrCode): LineActionState => ({ kind: "refused", code })

/**
 * Whether `action` may run on the line as `record` has it: the one rule the
 * host's `planLineAction` and the page's menu both read. Update your files
 * only with a preview, since it is what you were shown before you chose it.
 */
export function lineActionState(
  action: LineAction,
  record: LineRecord,
): LineActionState {
  if (HOST_ONLY.has(action) && !record.commands) return refused(ERR.NOT_YOURS)
  if (action === "setup")
    return record.commit === null ? OK : refused(ERR.REFUSED)
  if (record.commit === null) return refused(ERR.NO_LINE)
  switch (action) {
    case "land":
      return record.yours.ahead === null || record.yours.ahead === 0
        ? refused(ERR.REFUSED)
        : OK
    case "follow":
      return record.yours.follow === null ? refused(ERR.REFUSED) : OK
    case "publish": {
      const { commit, behind, ahead } = record.published
      if (commit === null) return refused(ERR.NO_PUBLISH)
      if (ahead > 0) return refused(ERR.NOT_FAST_FORWARD)
      return behind === 0 ? refused(ERR.REFUSED) : OK
    }
  }
}

/**
 * A `line` command, decided from the record read in its own step
 * (`lineActionState`). Setting up writes exactly the immutable heads and log
 * the record proposed, the text you were shown.
 */
export function planLineAction(
  action: LineAction,
  record: LineRecord,
): LineDecision {
  const state = lineActionState(action, record)
  if (state.kind === "refused") return state
  const { onto } = record
  switch (action) {
    case "setup":
      return {
        kind: "setup",
        onto,
        heads: record.heads.proposed,
        log: record.log.proposed,
      }
    case "land":
    case "follow":
      return { kind: action, onto }
    case "publish":
      return { kind: "publish", onto, publish: record.publish }
  }
}

/**
 * Why a `line` command was refused, worded once: the host's answer, and the
 * project menu's reason for a publish it does not offer. `record` names the
 * bookmarks and counts.
 */
export function lineRefusal(
  action: LineAction,
  code: ErrCode,
  record: Pick<LineRecord, "publish" | "published">,
): string {
  const { publish, published } = record
  switch (code) {
    case ERR.NOT_YOURS:
      return "this host admits others, so it does not act on the repo as its owner: use jj on its machine"
    case ERR.NO_LINE:
      return "set up the project first"
    case ERR.NO_PUBLISH:
      return `this repo has no ${publish} bookmark to publish to`
    case ERR.NOT_FAST_FORWARD:
      return `${publish} has ${published.ahead === 1 ? "1 commit" : `${published.ahead} commits`} the project doesn't: bring ${published.ahead === 1 ? "it" : "them"} into the project first`
    default:
      switch (action) {
        case "setup":
          return "the project is already set up"
        case "land":
          return "your @- is not above the project: rebase onto it first"
        case "follow":
          return "your files have nothing to bring in from the project, or share no commit with it"
        case "publish":
          return `everything in the project is on ${publish} already`
      }
  }
}

/**
 * The base a thread is brought up to date with and integrated into (ADR-0060): its
 * WIP while the WIP is there, else the line: for a line thread, a WIP that
 * landed, and one gone (which only "continue on the line" moves). Null, the
 * lane's base not yet read, is the line.
 */
export const effectiveBase = (
  base: Pick<BaseRecord, "base" | "state"> | null,
): ThreadBase =>
  base?.base.kind === "wip" && base.state === "ok"
    ? base.base
    : { kind: "line" }

/** Where a thread's base moved since its lane last caught up with it (`baseMoved`). */
interface BaseMove {
  readonly base: ThreadBase
  /** The base's bookmark: the line's, or the WIP's. */
  readonly bookmark: string
  /** The commit the lane's newest `Pineta-Base` names, and the base's now. */
  readonly from: CommitId
  readonly to: CommitId
}

/**
 * How a thread's base has moved on since its lane last forked from it or
 * caught up (ADR-0060), or null: the commit its newest `Pineta-Base` names
 * (`start`) against where the base is now, the line's `commit` or the WIP's.
 * Never for a WIP gone, which only "continue on the line" moves. Commits
 * only: whether catching up would change a file is `catchUpOf`'s, which
 * also decides what a missing record or line means.
 */
function baseMoved(
  base: BaseRecord,
  line: LineRecord,
  commit: CommitId,
): BaseMove | null {
  if (base.state === "gone") return null
  const thread = effectiveBase(base)
  const now =
    thread.kind === "line"
      ? { bookmark: line.onto, commit }
      : line.wips.find(w => w.bookmark === thread.bookmark)
  return now === undefined || now.commit === base.start
    ? null
    : { base: thread, bookmark: now.bookmark, from: base.start, to: now.commit }
}

/**
 * What catching up would do to a thread, as the page can tell (S97):
 * - `current`: its base has not moved since the lane last caught up with
 *   it, or there is no line to catch up with;
 * - `unknown`: it moved, and the host has not yet read what that changes;
 *   or the host has never read the lane at all (no `pineta.base`): a lane
 *   whose turns changed no file never reached your repo;
 * - `nothing-new`: it moved, but by work the lane already holds, as after
 *   you integrated its own offer: catching up changes no file;
 * - `brings`: catching up changes `files` files in the lane. Only this one
 *   says the move, for the header's ↓ (`behindMark`).
 */
export type CatchUpNow =
  | { readonly kind: "current" }
  | { readonly kind: "unknown" }
  | { readonly kind: "nothing-new" }
  | {
      readonly kind: "brings"
      readonly move: BaseMove
      readonly files: number
    }

/**
 * `CatchUpNow` from the lane's base record and the line's. With no line set
 * up there is nothing to catch up with. With no record, the host has not read
 * the lane, so nothing is claimed. The host's read (`BaseRecord.catchUp`)
 * counts only when it was made at the commit the base is at now; else what
 * it would change is unknown.
 */
export function catchUpOf(
  base: BaseRecord | undefined,
  line: LineRecord | null,
): CatchUpNow {
  if (line === null || line.commit === null) return { kind: "current" }
  if (base === undefined) return { kind: "unknown" }
  const move = baseMoved(base, line, line.commit)
  if (move === null) return { kind: "current" }
  const read = base.catchUp
  if (read === null || read.to !== move.to) return { kind: "unknown" }
  return read.files.length === 0
    ? { kind: "nothing-new" }
    : { kind: "brings", move, files: read.files.length }
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
type UpdateFrom =
  | BaseMerge
  /** The WIP already holds nothing the lane lacks. */
  | { readonly kind: "nothing" }

/**
 * Why an update is refused: no line, or a WIP gone without landing; for a
 * catch-up with the parent, none, or its agent running (ADR-0072).
 */
export type UpdateRefusal =
  | typeof ERR.NO_LINE
  | typeof ERR.BASE_GONE
  | typeof ERR.NO_PARENT
  | typeof ERR.PARENT_RUNNING

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
  /** `wipState` of a WIP base (`@pineta/repo`); "ok" for the line. */
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

/** The thread a lane branched from, as the document says it now (`parentNow`, ADR-0072). */
export interface ParentNow extends ParentThread {
  /** Its newest commit: the nearest above its thread's end. */
  readonly newest: CommitId
  /** The newest of its commits this lane holds: its fork commit, or what a catch-up merged. */
  readonly caughtUpWith: CommitId
  /** The files conflicted in `newest` (`conflictsAt`). */
  readonly conflicts: readonly string[]
}

/**
 * The thread `lane` branched from (`forkParent`) and where both stand, read
 * from the document alone: a lane's commits only move forward along its
 * bookmark, so the parent is ahead exactly when its newest commit is not the
 * one this lane last caught up with. That is the fork commit, or the newest
 * commit of the parent's that an update or a resolution below the lane's
 * first prompt merged. Null for a lane that began at its base, or a parent
 * with no name or no commit yet. Pure.
 */
export function parentNow(input: {
  readonly index: TreeIndex
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  readonly lane: LaneName
  /** The lane's thread's end. */
  readonly tip: EntryId | null
  /** Each lane's thread's end. */
  readonly tipOf: (lane: LaneName) => EntryId | null
  readonly names: ReadonlyMap<LaneName, ThreadName>
}): ParentNow | null {
  const { index, revisions, tip } = input
  const fork = forkParent(index, revisions, input.lane, tip)
  if (fork === null || tip === null) return null
  const name = input.names.get(fork.lane)
  const parentTip = input.tipOf(fork.lane)
  const newest =
    parentTip === null
      ? null
      : nearestRevision(index, revisions, { kind: "entry", id: parentTip })
          .commit
  if (name === undefined || newest === null) return null
  const parents = new Set(
    [...revisions.values()].flatMap(r =>
      r.lane === fork.lane && r.commit !== null ? [r.commit] : [],
    ),
  )
  const first = firstPromptOf(index, revisions, input.lane, tip)
  let caughtUpWith = fork.commit
  for (const id of ancestry(index, tip).path) {
    // An update, a resolution or a `catch_up` result says what it merged.
    const merged = index.entries[id]?.message?.merged?.find(c => parents.has(c))
    if (merged !== undefined) {
      caughtUpWith = merged
      break
    }
    if (id === first) break
  }
  return {
    kind: "parent",
    lane: fork.lane,
    name,
    newest,
    caughtUpWith,
    conflicts: conflictsAt(revisions, newest),
  }
}

/**
 * What catching up with the parent merges (ADR-0072): its newest commit;
 * nothing when the lane holds it; refused with no parent, or while the
 * parent's agent runs, since its copy moves with every turn. Pure.
 */
export function planParentUpdate(
  parent: ParentNow | null,
  running: boolean,
):
  | Extract<BaseMerge, { readonly kind: "parent" }>
  | { readonly kind: "nothing" }
  | typeof ERR.NO_PARENT
  | typeof ERR.PARENT_RUNNING {
  if (parent === null) return ERR.NO_PARENT
  if (running) return ERR.PARENT_RUNNING
  if (!parentAhead(parent)) return { kind: "nothing" }
  return {
    kind: "parent",
    lane: parent.lane,
    name: parent.name,
    commit: parent.newest,
    caughtUpWith: parent.caughtUpWith,
  }
}

/** What a merge planned for an update merges, as `catchUpName` words it. */
export const mergedFrom = (merge: BaseMerge): CatchUpFrom =>
  merge.kind === "line"
    ? { kind: "line" }
    : merge.kind === "wip"
      ? { kind: "wip", bookmark: merge.bookmark }
      : { kind: "parent", lane: merge.lane, name: merge.name }

/**
 * What a catch-up merges, as people read it: the integration line is "the
 * project", whatever its bookmark is called; a WIP is its bookmark; the
 * thread a thread branched from is its name (ADR-0072). The one place it is
 * worded: the bookmark of the line goes in titles only.
 */
export const catchUpName = (from: CatchUpFrom): string =>
  from.kind === "line"
    ? "the project"
    : from.kind === "wip"
      ? from.bookmark
      : from.name

/** The parent's newest commit is not the one the lane last caught up with (`ParentNow`). */
export const parentAhead = (parent: ParentNow): boolean =>
  parent.newest !== parent.caughtUpWith
