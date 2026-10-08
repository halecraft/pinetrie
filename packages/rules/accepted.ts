// accepted — accepted work (ADR-0104, ADR-0076, ADR-0090): its record
// (`pinetrie.accepted`), from what the host read (`planAcceptedRecord`),
// whether a setup or publish may run (`acceptedActionState`) and why not
// (`acceptedRefusal`), what a publish would do (`publishWork`), the command
// (`planAcceptedAction`) and a publish's second round (`planPublishFinish`).
// A setup or publish's steps are `@pinetrie/repo`'s (`planSetup`,
// `planPublishCatchUp`, `planPublishMove`, `planCatchUpUndo`). A thread's
// base on accepted work is `base.ts`'s.

import {
  type AcceptedAction,
  type AcceptedDecision,
  type AcceptedFacts,
  type AcceptedRecord,
  commitId,
  ERR,
  type ErrCode,
  type PublishDecision,
  type PublishFinish,
} from "@pinetrie/core"
import { Type } from "typebox"
import { CommitSchema, decodeAt, fixedKey } from "./decode.ts"
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
  publishCatchesUp: Type.Boolean(),
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

/**
 * Accepted work's record, the page's cache, from what the host read of it
 * (ADR-0104): what setting it up would write to your repo's config
 * (`proposed`, `setupProposal`), and whether a publish catches your files up
 * (`publish.catchUp`, ADR-0099).
 */
export function planAcceptedRecord(input: {
  readonly facts: AcceptedFacts
  /** Accepted work's bookmark, the WIP prefix, the publish bookmark and `catchUp`. */
  readonly repoConfig: {
    readonly acceptedBookmark: string
    readonly wipPrefix: string
    readonly publish: string
    readonly publishCatchesUp: boolean
  }
  readonly proposed: { readonly heads: string; readonly log: string }
}): AcceptedRecord {
  const { facts, repoConfig, proposed } = input
  return {
    acceptedBookmark: repoConfig.acceptedBookmark,
    wipPrefix: repoConfig.wipPrefix,
    publish: repoConfig.publish,
    commit: facts.commit,
    heads: { current: facts.heads, proposed: proposed.heads },
    log: { current: facts.log, proposed: proposed.log },
    wips: facts.wips,
    published: facts.published,
    yours: facts.yours,
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

/** What a publish would do (ADR-0090): what the button counts and its title says. */
export interface PublishWork {
  /** Line commits the publish bookmark lacks. */
  readonly acceptedCommits: number
  /** Your commits below `@` it accepts: 0 with `publish.catchUp` off. */
  readonly yours: number
  /** Whether your files catch up first: never with `publish.catchUp` off. */
  readonly catchUp: boolean
}

/**
 * What a publish would do now. With `publish.catchUp` off it moves the publish
 * bookmark alone, so your files and commits count for nothing.
 */
export function publishWork(
  record: Pick<AcceptedRecord, "publishCatchesUp" | "published" | "yours">,
): PublishWork {
  const { publishCatchesUp, published, yours } = record
  return {
    acceptedCommits: published.commit === null ? 0 : published.behind,
    yours: publishCatchesUp ? yours.ahead : 0,
    catchUp: publishCatchesUp && yours.behind > 0,
  }
}

/** Nothing for a publish to do: the page hides its button, and the host refuses it. */
export const nothingToPublish = (work: PublishWork): boolean =>
  work.acceptedCommits === 0 && work.yours === 0 && !work.catchUp

/**
 * Whether `action` may run on accepted work as `record` has it: the one rule the
 * host's `planAcceptedAction` and the page's button both read. Anyone admitted
 * may set up or publish (ADR-0099). A publish is refused before its first
 * step for whatever can be checked then (ADR-0090): with `publish.catchUp` on,
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
  if (record.publishCatchesUp) {
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
      return yours.behind > 0 &&
        yours.catchUp === null &&
        record.publishCatchesUp
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
