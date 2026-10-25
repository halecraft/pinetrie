// base — a thread's base and catching up with it, and the thread a lane
// branched from.

import {
  type BaseMerge,
  type CommitId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  type FolderBaseRecord,
  type ForkStart,
  type JjAcceptedRecord,
  type JjBaseRecord,
  type LaneBase,
  type ParentThread,
  type PointId,
  pointFromCommit,
  type RevisionRecord,
  type ThreadBase,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import {
  ancestry,
  forkParent,
  laneFirstPrompt,
  messageMerged,
  nearestRevision,
  pointConflicts,
  type TreeIndex,
} from "@pinetrie/threads"
import { Type } from "typebox"
import type { AcceptedRecord } from "./accepted.ts"
import {
  CommitSchema,
  PointSchema,
  recordDecoder,
  threadKey,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const WorkSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("some"),
  Type.Literal("unknown"),
])

const JjBaseSchema = Type.Object({
  kind: Type.Literal("jj"),
  base: Type.Union([
    Type.Object({ kind: Type.Literal("accepted") }),
    Type.Object({
      kind: Type.Literal("unfinished"),
      bookmark: Type.String({ minLength: 1 }),
    }),
  ]),
  start: CommitSchema,
  state: Type.Union([
    Type.Literal("ok"),
    Type.Literal("landed"),
    Type.Literal("gone"),
  ]),
  getLatest: Type.Union([
    Type.Object({
      tip: CommitSchema,
      to: CommitSchema,
      files: Type.Array(Type.String()),
    }),
    Type.Null(),
  ]),
  untraced: Type.Array(CommitSchema),
  work: WorkSchema,
})

const FolderBaseSchema = Type.Object({
  kind: Type.Literal("folder"),
  start: PointSchema,
  getLatest: Type.Union([
    Type.Object({
      tip: PointSchema,
      to: PointSchema,
      files: Type.Array(Type.String()),
    }),
    Type.Null(),
  ]),
  work: WorkSchema,
})

/** A lane's base record as stored: jj's or a folder's. */
const BaseRecordSchema = Type.Union([JjBaseSchema, FolderBaseSchema])

const copiedGetLatest = <G extends { readonly files: readonly string[] }>(
  getLatest: G | null,
) => (getLatest === null ? null : { ...getLatest, files: [...getLatest.files] })

/**
 * A thread's base as its lane's history says it: a host-written
 * `pinetrie.base` value keyed by lane, of the project's kind, a cache the
 * page reads. At start the host deletes those of the other kind.
 */
export type BaseRecord = JjBaseRecord | FolderBaseRecord

/**
 * Each lane's base, as its history says it, of the project's kind, at the
 * lane. A record written before records had a kind decodes as none, until
 * the host writes it again.
 */
export const BASE: RecordSpec<
  BaseRecord,
  ThreadId,
  "session",
  typeof BaseRecordSchema
> = {
  namespace: "pinetrie.base",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) =>
    contents.kind === "folder"
      ? { ...contents, getLatest: copiedGetLatest(contents.getLatest) }
      : {
          ...contents,
          getLatest: copiedGetLatest(contents.getLatest),
          base: { ...contents.base },
          untraced: [...contents.untraced],
        },
  decode: recordDecoder(
    BaseRecordSchema,
    threadKey,
    (r, lane): BaseRecord =>
      r.kind === "folder"
        ? { ...r, lane }
        : {
            kind: "jj",
            lane,
            base: r.base,
            start: commitId(r.start),
            state: r.state,
            getLatest:
              r.getLatest === null
                ? null
                : {
                    tip: commitId(r.getLatest.tip),
                    to: commitId(r.getLatest.to),
                    files: r.getLatest.files,
                  },
            untraced: r.untraced.map(commitId),
            work: r.work,
          },
  ),
}

/** What of a lane's base record says which base it follows. */
export type FollowedBase =
  | Pick<JjBaseRecord, "kind" | "base" | "state">
  | Pick<FolderBaseRecord, "kind">

/**
 * The base a thread is brought up to date with and accepted into: its
 * WIP while the WIP is there, else accepted work: for a thread on accepted work, a WIP that
 * landed, and one gone (which only "continue on accepted work" moves). Null, the
 * lane's base not yet read, is accepted work.
 */
export const effectiveBase = (base: FollowedBase | null): ThreadBase =>
  base?.kind === "jj" && base.base.kind === "unfinished" && base.state === "ok"
    ? base.base
    : { kind: "accepted" }

/** Where a thread's base moved since its lane last caught up with it (`baseMoved`). */
interface BaseMove {
  readonly base: ThreadBase
  /** The base's bookmark: accepted work's, or the WIP's; null for a folder project's accepted work. */
  readonly bookmark: string | null
  /** The state the lane last began on or caught up with, and the base's now. */
  readonly from: PointId
  readonly to: PointId
}

/**
 * How a thread's base has moved on since its lane last forked from it or
 * caught up, or null: the commit its newest `Pinetrie-Base` names
 * (`start`) against where the base is now, accepted work's `commit` or the WIP's.
 * Never for a WIP gone, which only "continue on accepted work" moves. Commits
 * only: whether catching up would change a file is `latestNow`'s, which
 * also decides what a missing record or line means.
 */
function baseMoved(
  base: JjBaseRecord,
  accepted: JjAcceptedRecord,
  commit: CommitId,
): BaseMove | null {
  if (base.state === "gone") return null
  const thread = effectiveBase(base)
  const now =
    thread.kind === "accepted"
      ? { bookmark: accepted.acceptedBookmark, commit }
      : accepted.unfinishedWork.find(w => w.bookmark === thread.bookmark)
  return now === undefined || now.commit === base.start
    ? null
    : {
        base: thread,
        bookmark: now.bookmark,
        from: pointFromCommit(base.start),
        to: pointFromCommit(now.commit),
      }
}

/**
 * What catching up would do to a thread, as the page can tell:
 * - `current`: its base has not moved since the lane last caught up with
 *   it, or there is no line to catch up with;
 * - `unknown`: it moved, and the host has not yet read what that changes;
 *   or the host has never read the lane at all (no `pinetrie.base`): a lane
 *   whose turns changed no file never reached your repo;
 * - `nothing-new`: it moved, but by work the lane already holds, as after
 *   you accepted its own proposed changes: catching up changes no file;
 * - `brings`: catching up changes `files` files in the lane. Only this one
 *   says the move, on the changes row and its get-the-latest button.
 */
export type LatestNow =
  | { readonly kind: "current" }
  | { readonly kind: "unknown" }
  | { readonly kind: "nothing-new" }
  | {
      readonly kind: "brings"
      readonly move: BaseMove
      readonly files: number
    }

/**
 * `LatestNow` from the lane's base record and accepted work's, of one
 * kind. With no line set up there is nothing to catch up with. With no
 * record, or one of another kind (swept at start), the host has not read
 * the lane, so nothing is claimed. The host's read (`getLatest`) counts only
 * when it was made at the state the base is at now; else what it would
 * change is unknown.
 */
export function latestNow(
  base: BaseRecord | undefined,
  accepted: AcceptedRecord | null,
): LatestNow {
  if (accepted === null) return { kind: "current" }
  if (accepted.kind === "folder") {
    if (base?.kind !== "folder") return { kind: "unknown" }
    if (base.start === accepted.newest) return { kind: "current" }
    return getLatestRead(base.getLatest, {
      base: { kind: "accepted" },
      bookmark: null,
      from: base.start,
      to: accepted.newest,
    })
  }
  if (accepted.commit === null) return { kind: "current" }
  if (base?.kind !== "jj") return { kind: "unknown" }
  const move = baseMoved(base, accepted, accepted.commit)
  if (move === null) return { kind: "current" }
  return getLatestRead(
    base.getLatest === null
      ? null
      : { to: pointFromCommit(base.getLatest.to), files: base.getLatest.files },
    move,
  )
}

/** A moved base's `LatestNow`, from the host's read of what catching up changes. */
const getLatestRead = (
  read: {
    readonly to: PointId
    readonly files: readonly string[]
  } | null,
  move: BaseMove,
): LatestNow => {
  if (read === null || read.to !== move.to) return { kind: "unknown" }
  return read.files.length === 0
    ? { kind: "nothing-new" }
    : { kind: "brings", move, files: read.files.length }
}

/** Where agent work begins when nothing is above: accepted work, or a WIP's copy. */
export type ForkBegin = Extract<
  ForkStart,
  { readonly kind: "accepted" | "unfinished" }
>

/**
 * Where a new lane begins when it has no agent work to inherit,
 * from the thread's base and what the host read of your repo: accepted work's
 * commit, or a copy of the WIP on accepted commit under it. Refused with no
 * line (`not-set-up`), and for a base that is not a WIP bookmark above accepted work
 * (`bad-base`).
 */
export function planBegin(input: {
  /** The WIP bookmark chosen at the first message; null for accepted work. */
  readonly base: string | null
  readonly wipPrefix: string
  readonly facts: {
    /** Accepted work's commit; null before it is set up. */
    readonly acceptedCommit: CommitId | null
    /** The WIP's commit and accepted commit under it; null when it is no WIP above accepted work. */
    readonly unfinished: {
      readonly commit: CommitId
      readonly under: CommitId
    } | null
  }
}): ForkBegin | ErrCode {
  const { base, facts } = input
  if (facts.acceptedCommit === null) return ERR.NOT_SET_UP
  if (base === null)
    return { kind: "accepted", point: pointFromCommit(facts.acceptedCommit) }
  if (!base.startsWith(input.wipPrefix) || facts.unfinished === null)
    return ERR.BAD_BASE
  return { kind: "unfinished", bookmark: base, ...facts.unfinished }
}

/** What an update merges into a lane, or nothing. */
type UpdateFrom =
  | BaseMerge
  /** The WIP already holds nothing the lane lacks. */
  | { readonly kind: "nothing" }

/**
 * Why an update is refused: no line, or a WIP gone without landing; for a
 * catch-up with the parent, none, or its agent running.
 */
type UpdateRefusal =
  | typeof ERR.NOT_SET_UP
  | typeof ERR.BASE_GONE
  | typeof ERR.NO_PARENT
  | typeof ERR.PARENT_RUNNING

/**
 * Why an update was refused, worded once: the agent reads it in
 * `catch_up`'s answer, and a person on the card that asked for it.
 */
export function updateRefusal(code: UpdateRefusal): string {
  switch (code) {
    case ERR.NOT_SET_UP:
      return "set up accepted work first"
    case ERR.BASE_GONE:
      return "this thread's unfinished work is gone: continue it on accepted work"
    case ERR.NO_PARENT:
      return "this thread did not branch from another thread's copy"
    case ERR.PARENT_RUNNING:
      return "the thread this one branched from is working: get its latest when its run ends"
  }
}

/**
 * What bringing a thread up to date merges: the base the thread
 * follows (`effectiveBase`), so the button that names it names what is
 * merged. A WIP thread merges a fresh copy of its WIP, on the lane's
 * previous copy, unless the lane's base already names the WIP's commit now. A
 * thread on accepted work, a lane with no base, and a landed WIP merge accepted work's commit.
 * A WIP gone without landing refuses (`base-gone`) until `toAccepted` ("continue
 * on accepted work") moves the thread to accepted work, marking the move even when
 * nothing is merged. With no line, refused (`not-set-up`).
 */
export function planUpdateFrom(input: {
  /** The lane's base, from its own history; null for a lane with none, on accepted work. */
  readonly base: LaneBase | null
  /** `unfinishedState` of a WIP base (`@pinetrie/jj`); "ok" for accepted work. */
  readonly state: JjBaseRecord["state"]
  /** "continue on accepted work": the thread moves to accepted work, whatever its base. */
  readonly toAccepted: boolean
  /** Accepted work's state; null before it is set up. */
  readonly acceptedPoint: PointId | null
  /** For a WIP base: its commit now and accepted commit under it (`beginFacts`). */
  readonly unfinishedNow: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}): UpdateFrom | UpdateRefusal {
  const { base, state, unfinishedNow } = input
  if (input.acceptedPoint === null) return ERR.NOT_SET_UP
  if (!input.toAccepted && state === "gone") return ERR.BASE_GONE
  const followed: ThreadBase = input.toAccepted
    ? { kind: "accepted" }
    : effectiveBase({
        kind: "jj",
        base: base?.base ?? { kind: "accepted" },
        state,
      })
  if (followed.kind === "accepted")
    return {
      kind: "accepted",
      point: input.acceptedPoint,
      mark: input.toAccepted && base?.base.kind === "unfinished",
    }
  if (base === null || unfinishedNow === null) return ERR.BASE_GONE
  // The WIP's commit is jj's alone; the lane's source is a state of the
  // shared history, so the commit crosses as the point it is.
  return pointFromCommit(unfinishedNow.commit) === base.source
    ? { kind: "nothing" }
    : {
        kind: "unfinished",
        bookmark: followed.bookmark,
        ...unfinishedNow,
        on: base.start,
      }
}

/** The thread a lane branched from, as the document says it now (`parentNow`). */
export interface ParentNow extends ParentThread {
  /** Its newest state: the nearest above its thread's end. */
  readonly newest: PointId
  /** The newest of its states this lane holds: its fork state, or what a catch-up merged. */
  readonly upToDateWith: PointId
  /** The files conflicted in `newest` (`pointConflicts`). */
  readonly conflicts: readonly string[]
}

/**
 * The thread `lane` branched from (`forkParent`) and where both stand, read
 * from the document alone: a lane's states only move forward along its
 * line, so the parent is ahead exactly when its newest state is not the
 * one this lane last caught up with. That is the fork state, or the newest
 * state of the parent's that an update or a resolution below the lane's
 * first prompt merged. Null for a lane that began at its base, or a parent
 * with no name or no state yet.
 */
export function parentNow(input: {
  readonly index: TreeIndex
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  readonly lane: ThreadId
  /** The lane's thread's end. */
  readonly tip: EntryId | null
  /** Each lane's thread's end. */
  readonly tipOf: (lane: ThreadId) => EntryId | null
  readonly names: ReadonlyMap<ThreadId, ThreadName>
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
          .point
  if (name === undefined || newest === null) return null
  const parents = new Set(
    [...revisions.values()].flatMap(r =>
      r.lane === fork.lane && r.point !== null ? [r.point] : [],
    ),
  )
  const first = laneFirstPrompt(index, revisions, input.lane, tip)
  let upToDateWith = fork.point
  for (const id of ancestry(index, tip).path) {
    // An update, a resolution or a `catch_up` result says what it merged.
    const merged = messageMerged(index.entries[id]?.message)?.find(c =>
      parents.has(c),
    )
    if (merged !== undefined) {
      upToDateWith = merged
      break
    }
    if (id === first) break
  }
  return {
    kind: "parent",
    lane: fork.lane,
    name,
    newest,
    upToDateWith,
    conflicts: pointConflicts(revisions, newest),
  }
}

/**
 * What catching up with the parent merges: its newest state;
 * nothing when the lane holds it; refused with no parent, or while the
 * parent's agent runs, since its copy moves with every turn.
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
    point: parent.newest,
    upToDateWith: parent.upToDateWith,
  }
}

/** The parent's newest state is not the one the lane last caught up with (`ParentNow`). */
export const parentAhead = (parent: ParentNow): boolean =>
  parent.newest !== parent.upToDateWith
