// accepted — accepted work: its record, whether a setup or publish may run,
// and what a publish does. A thread's base on accepted work is `base.ts`'s.

import {
  type AcceptedFacts,
  type AcceptedWorkDecision,
  commitId,
  ERR,
  type ErrCode,
  type JjAcceptedRecord,
  type PointId,
  type PublishDecision,
  type PublishFinish,
} from "@pinetrie/core"
import type { AcceptedAction } from "@pinetrie/threads"
import { Type } from "typebox"
import {
  CommitSchema,
  fixedKey,
  List,
  PointSchema,
  recordDecoder,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.accepted` value's key: a host has one repo. */
export const ACCEPTED_KEY = "accepted"

const JjAcceptedSchema = Type.Object({
  kind: Type.Literal("jj"),
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
  unfinishedWork: Type.Array(
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
  workingCopy: Type.Object({
    behind: Type.Integer({ minimum: 0 }),
    ahead: Type.Integer({ minimum: 0 }),
    getLatest: Type.Union([
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
  publishCatchesUp: Type.Boolean(),
})

const FolderAcceptedSchema = Type.Object({
  kind: Type.Literal("folder"),
  newest: PointSchema,
  kept: List(PointSchema),
  at: Type.Number(),
})

/** Accepted work's record as stored: jj's or a folder's. */
const AcceptedRecordSchema = Type.Union([
  JjAcceptedSchema,
  FolderAcceptedSchema,
])

/**
 * A folder project's accepted work, as the host last read the project's
 * folder: its newest state, and what of its history the host keeps.
 */
export interface FolderAcceptedRecord {
  readonly kind: "folder"
  readonly newest: PointId
  /**
   * Accepted work's states whose snapshots the host keeps, newest first:
   * line states and concurrent saves. What the history may review and
   * restore.
   */
  readonly kept: readonly PointId[]
  readonly at: number
}

/**
 * Accepted work as the host last read it: a host-written `pinetrie.accepted`
 * value of the project's kind, a cache the page reads. At start the host
 * deletes one of the other kind.
 */
export type AcceptedRecord = JjAcceptedRecord | FolderAcceptedRecord

/**
 * Accepted work, of the project's kind, at its one key. A record written
 * before records had a kind decodes as none, until the host writes it again.
 */
export const ACCEPTED: RecordSpec<
  AcceptedRecord,
  typeof ACCEPTED_KEY,
  "session",
  typeof AcceptedRecordSchema
> = {
  namespace: "pinetrie.accepted",
  home: "session",
  keyOf: () => ACCEPTED_KEY,
  encode: r =>
    r.kind === "folder"
      ? { ...r, kept: [...r.kept] }
      : {
          ...r,
          heads: { ...r.heads },
          log: { ...r.log },
          unfinishedWork: r.unfinishedWork.map(w => ({ ...w })),
          published: { ...r.published },
          workingCopy: {
            ...r.workingCopy,
            getLatest:
              r.workingCopy.getLatest === null
                ? null
                : {
                    ...r.workingCopy.getLatest,
                    conflicts: [...r.workingCopy.getLatest.conflicts],
                  },
            conflicts: {
              ...r.workingCopy.conflicts,
              files: [...r.workingCopy.conflicts.files],
            },
          },
        },
  decode: recordDecoder(
    AcceptedRecordSchema,
    key => fixedKey(ACCEPTED_KEY, key),
    (r): AcceptedRecord =>
      r.kind === "folder"
        ? r
        : {
            ...r,
            commit: r.commit === null ? null : commitId(r.commit),
            unfinishedWork: r.unfinishedWork.map(w => ({
              ...w,
              commit: commitId(w.commit),
            })),
            published: {
              ...r.published,
              commit:
                r.published.commit === null
                  ? null
                  : commitId(r.published.commit),
            },
          },
  ),
}

/**
 * Accepted work's record, the page's cache, from what the host read of it: what
 * setting it up would write to your repo's config (`proposed`,
 * `setupProposal`), and whether a publish catches the working copy up
 * (`publish.catchUp`).
 */
export function planAcceptedRecord(input: {
  readonly facts: AcceptedFacts
  /** Accepted work's bookmark, the WIP prefix, the publish bookmark and `getLatest`. */
  readonly repoConfig: {
    readonly acceptedBookmark: string
    readonly wipPrefix: string
    readonly publish: string
    readonly publishCatchesUp: boolean
  }
  readonly proposed: { readonly heads: string; readonly log: string }
}): JjAcceptedRecord {
  const { facts, repoConfig, proposed } = input
  return {
    kind: "jj",
    acceptedBookmark: repoConfig.acceptedBookmark,
    wipPrefix: repoConfig.wipPrefix,
    publish: repoConfig.publish,
    commit: facts.commit,
    heads: { current: facts.heads, proposed: proposed.heads },
    log: { current: facts.log, proposed: proposed.log },
    unfinishedWork: facts.unfinishedWork,
    published: facts.published,
    workingCopy: facts.workingCopy,
    publishCatchesUp: repoConfig.publishCatchesUp,
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

/** What a publish would do: what the button counts and its title says. */
export interface PublishWork {
  /** Line commits the publish bookmark lacks. */
  readonly acceptedCommits: number
  /** Your commits below `@` it accepts: 0 with `publish.catchUp` off. */
  readonly workingCopyCommits: number
  /** Whether the working copy catches up first: never with `publish.catchUp` off. */
  readonly getLatest: boolean
}

/**
 * What a publish would do now. With `publish.catchUp` off it moves the publish
 * bookmark alone, so the working copy and your commits count for nothing.
 */
export function publishWork(
  record: Pick<
    JjAcceptedRecord,
    "publishCatchesUp" | "published" | "workingCopy"
  >,
): PublishWork {
  const { publishCatchesUp, published, workingCopy } = record
  return {
    acceptedCommits: published.commit === null ? 0 : published.behind,
    workingCopyCommits: publishCatchesUp ? workingCopy.ahead : 0,
    getLatest: publishCatchesUp && workingCopy.behind > 0,
  }
}

/** Nothing for a publish to do: the page hides its button, and the host refuses it. */
export const nothingToPublish = (work: PublishWork): boolean =>
  work.acceptedCommits === 0 && work.workingCopyCommits === 0 && !work.getLatest

/**
 * Whether `action` may run on accepted work as `record` has it: the one rule the
 * host's `planAcceptedAction` and the page's button both read. Anyone admitted
 * may set up or publish. A publish is refused before its first
 * step for whatever can be checked then: with `publish.catchUp` on,
 * the working copy's conflicts and the catch-up's preview among them.
 */
export function acceptedActionState(
  action: AcceptedAction,
  record: AcceptedRecord,
): AcceptedActionState {
  // A folder project's accepted work is its folder: there is nothing to set up or publish to.
  if (record.kind === "folder") return refused(ERR.REFUSED)
  if (action === "setup")
    return record.commit === null ? OK : refused(ERR.REFUSED)
  if (record.commit === null) return refused(ERR.NOT_SET_UP)
  const { published, workingCopy } = record
  if (published.commit === null) return refused(ERR.NO_PUBLISH)
  if (published.ahead > 0) return refused(ERR.NOT_FAST_FORWARD)
  if (record.publishCatchesUp) {
    if (
      workingCopy.conflicts.commits > 0 ||
      workingCopy.conflicts.files.length > 0 ||
      (workingCopy.getLatest?.conflicts.length ?? 0) > 0
    )
      return refused(ERR.WORKING_COPY_CONFLICT)
    // Behind, with no commit in common: there is no rebase to preview.
    if (workingCopy.behind > 0 && workingCopy.getLatest === null)
      return refused(ERR.REFUSED)
  }
  return nothingToPublish(publishWork(record)) ? refused(ERR.REFUSED) : OK
}

/**
 * A setup or publish, decided from the record read in its own step
 * (`acceptedActionState`). Setting up writes exactly the immutable heads and
 * log the record proposed, the text you were shown.
 */
declare const publishTicketBrand: unique symbol
/**
 * A publish `planAcceptedAction` decided on: only it makes one, so a
 * publish's second round (`planPublishFinish`) follows the decision its
 * first round carried out.
 */
export type PublishTicket = PublishDecision & {
  readonly [publishTicketBrand]: true
}

export function planAcceptedAction(
  action: AcceptedAction,
  record: JjAcceptedRecord,
): Exclude<AcceptedWorkDecision, PublishDecision> | PublishTicket {
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
    getLatest: work.getLatest,
    accept: work.workingCopyCommits > 0,
  } as PublishTicket
}

/**
 * A publish's second round, from accepted work's record as read again
 * after the catch-up (`after`), and the operation the catch-up wrote. Without
 * a catch-up there is nothing to undo, and every check ran before the first
 * step. After one, the catch-up's operation is reverted when your commits are
 * now conflicted, which the preview of `@` alone cannot show, or the publish
 * bookmark moved meanwhile. Whether your commits move with accepted work is read
 * from `after`.
 */
export function planPublishFinish(input: {
  /** The decision the first round carried out. */
  readonly decision: PublishTicket
  readonly after: JjAcceptedRecord
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
  if (after.workingCopy.conflicts.commits > 0)
    return { kind: "undo", op, code: ERR.WORKING_COPY_CONFLICT }
  if (after.published.ahead > 0)
    return { kind: "undo", op, code: ERR.NOT_FAST_FORWARD }
  return { ...move, accept: after.workingCopy.ahead > 0 }
}
