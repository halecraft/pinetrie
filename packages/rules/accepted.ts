// accepted — accepted work and a thread's base on it (ADR-0060,
// ADR-0061, ADR-0072, ADR-0076, ADR-0090): accepted work's and each lane's base's
// records (`pinetrie.accepted`, `pinetrie.base`), accepted work's record from what the
// host read (`planAcceptedRecord`), whether a setup or publish may run
// (`acceptedActionState`) and why not (`acceptedRefusal`), what a publish would do
// (`publishWork`), the command (`planAcceptedAction`) and a publish's second
// round (`planPublishFinish`), where a new lane begins (`planBegin`), the
// base a thread follows (`effectiveBase`), what catching up with it would do
// (`catchUpOf`) and merge (`planUpdateFrom`), and the thread a lane branched
// from (`parentNow`, `planParentUpdate`).
// A setup or publish's steps are `@pinetrie/repo`'s (`planSetup`,
// `planPublishCatchUp`, `planPublishMove`, `planCatchUpUndo`).

import {
  type AcceptedAction,
  type AcceptedDecision,
  type AcceptedFacts,
  type AcceptedRecord,
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
  nearestRevision,
  type ParentThread,
  type PublishDecision,
  type PublishFinish,
  type RevisionRecord,
  type ThreadBase,
  type ThreadName,
  type TreeIndex,
} from "@pinetrie/core"
import { Type } from "typebox"
import { CommitSchema, decodeAt, fixedKey, laneKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.accepted` value's key: a host has one repo. */
export const ACCEPTED_KEY = "accepted"

const AcceptedRecordSchema = Type.Object({
  acceptedBookmark: Type.String({ minLength: 1 }),
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
    ahead: Type.Integer({ minimum: 0 }),
    catchUp: Type.Union([
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
  catchUp: Type.Boolean(),
})

const BaseRecordSchema = Type.Object({
  base: Type.Union([
    Type.Object({ kind: Type.Literal("accepted") }),
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

/** Accepted work, at its one key. */
export const ACCEPTED: RecordSpec<
  AcceptedRecord,
  typeof ACCEPTED_KEY,
  "session"
> = {
  namespace: "pinetrie.accepted",
  home: "session",
  keyOf: () => ACCEPTED_KEY,
  encode: r => ({
    ...r,
    heads: { ...r.heads },
    log: { ...r.log },
    wips: r.wips.map(w => ({ ...w })),
    published: { ...r.published },
    yours: {
      ...r.yours,
      catchUp:
        r.yours.catchUp === null
          ? null
          : {
              ...r.yours.catchUp,
              conflicts: [...r.yours.catchUp.conflicts],
            },
      conflicts: {
        ...r.yours.conflicts,
        files: [...r.yours.conflicts.files],
      },
    },
  }),
  decode: (contents, key) =>
    decodeAt(
      AcceptedRecordSchema,
      contents,
      fixedKey(ACCEPTED_KEY, key),
      r => ({
        ...r,
        commit: r.commit === null ? null : commitId(r.commit),
        wips: r.wips.map(w => ({ ...w, commit: commitId(w.commit) })),
        published: {
          ...r.published,
          commit:
            r.published.commit === null ? null : commitId(r.published.commit),
        },
      }),
    ),
}

/** Each lane's base, as its history says it, at the lane. */
export const BASE: RecordSpec<BaseRecord, LaneName, "session"> = {
  namespace: "pinetrie.base",
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
 * Accepted work's record, the page's cache, from what the host read of it
 * (ADR-0060): what setting it up would write to your repo's config
 * (`proposed`, `setupProposal`), and whether a publish catches your files up
 * (`offers.catchUp`, ADR-0099).
 */
export function planAcceptedRecord(input: {
  readonly facts: AcceptedFacts
  /** Accepted work's bookmark, the WIP prefix, the publish bookmark and `catchUp`. */
  readonly repoConfig: {
    readonly acceptedBookmark: string
    readonly wipPrefix: string
    readonly publish: string
    readonly catchUp: boolean
  }
  readonly proposed: { readonly heads: string; readonly log: string }
}): AcceptedRecord {
  const { facts, repoConfig: line, proposed } = input
  return {
    acceptedBookmark: line.acceptedBookmark,
    wipPrefix: line.wipPrefix,
    publish: line.publish,
    commit: facts.commit,
    heads: { current: facts.heads, proposed: proposed.heads },
    log: { current: facts.log, proposed: proposed.log },
    wips: facts.wips,
    published: facts.published,
    yours: facts.yours,
    catchUp: line.catchUp,
  }
}

/** Whether a setup or a publish may run now, and if not, why. */
export type AcceptedActionState =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

const OK: AcceptedActionState = { kind: "ok" }
const refused = (code: ErrCode): AcceptedActionState => ({
  kind: "refused",
  code,
})

/** What a publish would do (ADR-0090): what the button counts and its title says. */
export interface PublishWork {
  /** Line commits the publish bookmark lacks. */
  readonly acceptedCommits: number
  /** Your commits below `@` it accepts: 0 with `offers.catchUp` off. */
  readonly yours: number
  /** Whether your files catch up first: never with `offers.catchUp` off. */
  readonly catchUp: boolean
}

/**
 * What a publish would do now. With `offers.catchUp` off it moves the publish
 * bookmark alone, so your files and commits count for nothing.
 */
export function publishWork(
  record: Pick<AcceptedRecord, "catchUp" | "published" | "yours">,
): PublishWork {
  const { catchUp, published, yours } = record
  return {
    acceptedCommits: published.commit === null ? 0 : published.behind,
    yours: catchUp ? yours.ahead : 0,
    catchUp: catchUp && yours.behind > 0,
  }
}

/** Nothing for a publish to do: the page hides its button, and the host refuses it. */
export const nothingToPublish = (work: PublishWork): boolean =>
  work.acceptedCommits === 0 && work.yours === 0 && !work.catchUp

/**
 * Whether `action` may run on accepted work as `record` has it: the one rule the
 * host's `planAcceptedAction` and the page's button both read. Anyone admitted
 * may set up or publish (ADR-0099). A publish is refused before its first
 * step for whatever can be checked then (ADR-0090): with `offers.catchUp` on,
 * your files' conflicts and the catch-up's preview among them.
 */
export function acceptedActionState(
  action: AcceptedAction,
  record: AcceptedRecord,
): AcceptedActionState {
  if (action === "setup")
    return record.commit === null ? OK : refused(ERR.REFUSED)
  if (record.commit === null) return refused(ERR.NOT_SET_UP)
  const { published, yours } = record
  if (published.commit === null) return refused(ERR.NO_PUBLISH)
  if (published.ahead > 0) return refused(ERR.NOT_FAST_FORWARD)
  if (record.catchUp) {
    if (
      yours.conflicts.commits > 0 ||
      yours.conflicts.files.length > 0 ||
      (yours.catchUp?.conflicts.length ?? 0) > 0
    )
      return refused(ERR.YOURS_CONFLICT)
    // Behind, with no commit in common: there is no rebase to preview.
    if (yours.behind > 0 && yours.catchUp === null) return refused(ERR.REFUSED)
  }
  return nothingToPublish(publishWork(record)) ? refused(ERR.REFUSED) : OK
}

/**
 * A setup or publish, decided from the record read in its own step
 * (`acceptedActionState`). Setting up writes exactly the immutable heads and log
 * the record proposed, the text you were shown.
 */
export function planAcceptedAction(
  action: AcceptedAction,
  record: AcceptedRecord,
): AcceptedDecision {
  const state = acceptedActionState(action, record)
  if (state.kind === "refused") return state
  const { acceptedBookmark } = record
  if (action === "setup")
    return {
      kind: "setup",
      acceptedBookmark,
      heads: record.heads.proposed,
      log: record.log.proposed,
    }
  const work = publishWork(record)
  return {
    kind: "publish",
    acceptedBookmark,
    publish: record.publish,
    catchUp: work.catchUp,
    accept: work.yours > 0,
  }
}

/**
 * A publish's second round (ADR-0090), from accepted work's record as read again
 * after the catch-up (`after`), and the operation the catch-up wrote. Without
 * a catch-up there is nothing to undo, and every check ran before the first
 * step. After one, the catch-up's operation is reverted when your commits are
 * now conflicted, which the preview of `@` alone cannot show, or the publish
 * bookmark moved meanwhile. Whether your commits move with accepted work is read
 * from `after`. Pure.
 */
export function planPublishFinish(input: {
  readonly decision: PublishDecision
  readonly after: AcceptedRecord
  /** The catch-up's operation; null without a catch-up. */
  readonly op: string | null
}): PublishFinish {
  const { decision, after, op } = input
  const move = {
    kind: "move",
    acceptedBookmark: decision.acceptedBookmark,
    publish: decision.publish,
  } as const
  if (op === null) return { ...move, accept: decision.accept }
  if (after.yours.conflicts.commits > 0)
    return { kind: "undo", op, code: ERR.YOURS_CONFLICT }
  if (after.published.ahead > 0)
    return { kind: "undo", op, code: ERR.NOT_FAST_FORWARD }
  return { ...move, accept: after.yours.ahead > 0 }
}

/** Files named, the first three, then how many more. */
export const named = (files: readonly string[]): string =>
  files.length <= 3
    ? files.join(", ")
    : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`

const commits = (n: number) => (n === 1 ? "1 commit" : `${n} commits`)

/**
 * Why a setup or publish was refused, worded once: the host's answer, and the
 * publish button's title for a publish it would refuse. `record` names the
 * bookmarks, counts and files.
 */
export function acceptedRefusal(
  action: AcceptedAction,
  code: ErrCode,
  record: AcceptedRecord,
): string {
  const { publish, published, yours } = record
  switch (code) {
    case ERR.NOT_SET_UP:
      return "set up first"
    case ERR.NO_PUBLISH:
      return `this repo has no ${publish} bookmark to publish to`
    case ERR.NOT_FAST_FORWARD:
      return `${publish} has ${commits(published.ahead)} accepted work doesn't: bring ${published.ahead === 1 ? "it" : "them"} into accepted work in jj first`
    case ERR.YOURS_CONFLICT: {
      const would = yours.catchUp?.conflicts ?? []
      if (yours.conflicts.files.length > 0)
        return `your files have conflicts in ${named(yours.conflicts.files)}`
      if (would.length > 0)
        return `catching your files up would conflict in ${named(would)}`
      return `${commits(yours.conflicts.commits)} of yours ${yours.conflicts.commits === 1 ? "has" : "have"} conflicts`
    }
    default:
      if (action === "setup") return "already set up"
      return yours.behind > 0 && yours.catchUp === null && record.catchUp
        ? "your files share no commit with accepted work: rebase onto it in jj"
        : "nothing to publish"
  }
}

/**
 * Why a publish's catch-up was reverted (`planPublishFinish`'s `undo`), from
 * the record read after it: the conflicts it would have left, since the
 * revert removed them; or the publish bookmark that moved meanwhile.
 */
export function publishUndone(
  code: Extract<PublishFinish, { readonly kind: "undo" }>["code"],
  after: AcceptedRecord,
): string {
  if (code !== ERR.YOURS_CONFLICT)
    return acceptedRefusal("publish", code, after)
  const n = after.yours.conflicts.commits
  return `catching your files up would leave ${commits(n)} of yours with conflicts`
}

/**
 * The base a thread is brought up to date with and accepted into (ADR-0060): its
 * WIP while the WIP is there, else accepted work: for a thread on accepted work, a WIP that
 * landed, and one gone (which only "continue on accepted work" moves). Null, the
 * lane's base not yet read, is accepted work.
 */
export const effectiveBase = (
  base: Pick<BaseRecord, "base" | "state"> | null,
): ThreadBase =>
  base?.base.kind === "wip" && base.state === "ok"
    ? base.base
    : { kind: "accepted" }

/** Where a thread's base moved since its lane last caught up with it (`baseMoved`). */
interface BaseMove {
  readonly base: ThreadBase
  /** The base's bookmark: accepted work's, or the WIP's. */
  readonly bookmark: string
  /** The commit the lane's newest `Pinetrie-Base` names, and the base's now. */
  readonly from: CommitId
  readonly to: CommitId
}

/**
 * How a thread's base has moved on since its lane last forked from it or
 * caught up (ADR-0060), or null: the commit its newest `Pinetrie-Base` names
 * (`start`) against where the base is now, accepted work's `commit` or the WIP's.
 * Never for a WIP gone, which only "continue on accepted work" moves. Commits
 * only: whether catching up would change a file is `catchUpOf`'s, which
 * also decides what a missing record or line means.
 */
function baseMoved(
  base: BaseRecord,
  accepted: AcceptedRecord,
  commit: CommitId,
): BaseMove | null {
  if (base.state === "gone") return null
  const thread = effectiveBase(base)
  const now =
    thread.kind === "accepted"
      ? { bookmark: accepted.acceptedBookmark, commit }
      : accepted.wips.find(w => w.bookmark === thread.bookmark)
  return now === undefined || now.commit === base.start
    ? null
    : { base: thread, bookmark: now.bookmark, from: base.start, to: now.commit }
}

/**
 * What catching up would do to a thread, as the page can tell (S97):
 * - `current`: its base has not moved since the lane last caught up with
 *   it, or there is no line to catch up with;
 * - `unknown`: it moved, and the host has not yet read what that changes;
 *   or the host has never read the lane at all (no `pinetrie.base`): a lane
 *   whose turns changed no file never reached your repo;
 * - `nothing-new`: it moved, but by work the lane already holds, as after
 *   you accepted its own offer: catching up changes no file;
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
 * `CatchUpNow` from the lane's base record and accepted work's. With no line set
 * up there is nothing to catch up with. With no record, the host has not read
 * the lane, so nothing is claimed. The host's read (`BaseRecord.catchUp`)
 * counts only when it was made at the commit the base is at now; else what
 * it would change is unknown.
 */
export function catchUpOf(
  base: BaseRecord | undefined,
  accepted: AcceptedRecord | null,
): CatchUpNow {
  if (accepted === null || accepted.commit === null) return { kind: "current" }
  if (base === undefined) return { kind: "unknown" }
  const move = baseMoved(base, accepted, accepted.commit)
  if (move === null) return { kind: "current" }
  const read = base.catchUp
  if (read === null || read.to !== move.to) return { kind: "unknown" }
  return read.files.length === 0
    ? { kind: "nothing-new" }
    : { kind: "brings", move, files: read.files.length }
}

/** Where agent work begins when nothing is above: accepted work, or a WIP's copy. */
export type ForkBegin = Extract<
  ForkStart,
  { readonly kind: "accepted" | "wip" }
>

/**
 * Where a new lane begins when it has no agent work to inherit (ADR-0060),
 * from the thread's base and what the host read of your repo: accepted work's
 * commit, or a copy of the WIP on accepted commit under it. Refused with no
 * line (`not_set_up`), and for a base that is not a WIP bookmark above accepted work
 * (`bad_base`). Pure.
 */
export function planBegin(input: {
  /** The WIP bookmark chosen at the first message; null for accepted work. */
  readonly base: string | null
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  readonly facts: {
    /** Accepted work's commit; null before it is set up. */
    readonly acceptedCommit: CommitId | null
    /** The WIP's commit and accepted commit under it; null when it is no WIP above accepted work. */
    readonly wip: { readonly commit: CommitId; readonly under: CommitId } | null
  }
}): ForkBegin | ErrCode {
  const { base, facts } = input
  if (facts.acceptedCommit === null) return ERR.NOT_SET_UP
  if (base === null)
    return {
      kind: "accepted",
      acceptedBookmark: input.acceptedBookmark,
      commit: facts.acceptedCommit,
    }
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
  | typeof ERR.NOT_SET_UP
  | typeof ERR.BASE_GONE
  | typeof ERR.NO_PARENT
  | typeof ERR.PARENT_RUNNING

/**
 * What bringing a thread up to date merges (ADR-0060): the base the thread
 * follows (`effectiveBase`), so the button that names it names what is
 * merged. A WIP thread merges a fresh copy of its WIP, on the lane's
 * previous copy, unless the lane's base already names the WIP's commit now. A
 * thread on accepted work, a lane with no base, and a landed WIP merge accepted work's commit.
 * A WIP gone without landing refuses (`base_gone`) until `toLine` ("continue
 * on accepted work") moves the thread to accepted work, marking the move even when
 * nothing is merged. With no line, refused (`not_set_up`). Pure.
 */
export function planUpdateFrom(input: {
  readonly acceptedBookmark: string
  /** The lane's base, from its own history; null for a lane with none, on accepted work. */
  readonly base: LaneBase | null
  /** `wipState` of a WIP base (`@pinetrie/repo`); "ok" for accepted work. */
  readonly state: BaseRecord["state"]
  /** "continue on accepted work": the thread moves to accepted work, whatever its base. */
  readonly toAccepted: boolean
  readonly acceptedCommit: CommitId | null
  /** For a WIP base: its commit now and accepted commit under it (`beginFacts`). */
  readonly wipNow: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}): UpdateFrom | UpdateRefusal {
  const { base, state, wipNow } = input
  if (input.acceptedCommit === null) return ERR.NOT_SET_UP
  if (!input.toAccepted && state === "gone") return ERR.BASE_GONE
  const followed: ThreadBase = input.toAccepted
    ? { kind: "accepted" }
    : effectiveBase({ base: base?.base ?? { kind: "accepted" }, state })
  if (followed.kind === "accepted")
    return {
      kind: "accepted",
      acceptedBookmark: input.acceptedBookmark,
      commit: input.acceptedCommit,
      mark: input.toAccepted && base?.base.kind === "wip",
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
  merge.kind === "accepted"
    ? { kind: "accepted" }
    : merge.kind === "wip"
      ? { kind: "wip", bookmark: merge.bookmark }
      : { kind: "parent", lane: merge.lane, name: merge.name }

/**
 * What a catch-up merges, as people read it: accepted work is
 * "accepted work", whatever its bookmark is called (ADR-0090); a WIP is its
 * bookmark; the thread a thread branched from is its name (ADR-0072). The
 * one place it is worded: the bookmark of accepted work goes in titles only.
 */
export const catchUpName = (from: CatchUpFrom): string =>
  from.kind === "accepted"
    ? "accepted work"
    : from.kind === "wip"
      ? from.bookmark
      : from.name

/** That a thread's base has work the thread lacks, with the base named by `catchUpName`. */
export const baseMovedOn = (from: CatchUpFrom): string =>
  `${catchUpName(from)} has moved on`

/** The parent's newest commit is not the one the lane last caught up with (`ParentNow`). */
export const parentAhead = (parent: ParentNow): boolean =>
  parent.newest !== parent.caughtUpWith
