// interface/answer-words — what a person is answered when a command of
// theirs is refused: each refusal's reason, decided by its plan, worded once
// here for the host's answer and for any client that shows it (the publish
// button's title among them). Words the agent reads are rules'.

import {
  ERR,
  type ErrCode,
  type JjAcceptedRecord,
  type PublishFinish,
  type Refusal,
  refused,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type BranchOutRefusal,
  type CopyPlan,
  displayName,
  foreignRefusal,
  type GateRefusal,
  type ImageRefusal,
  namesAndMore,
  type OpenPlan,
  type SetAside,
} from "@pinetrie/rules"
import type { AcceptedAction } from "@pinetrie/threads"

/** Why a command in a thread in an inventory is refused. */
export const IN_INVENTORY_WORDS = "put it on a canvas first"

/** Why a command in a trashed thread is refused. */
export const TRASHED_WORDS = "restore it first"

/** Why a command in a thread in an inventory or a trash is refused, as the host says it. */
const notOnCanvasWords = (setAside: SetAside): string =>
  setAside.kind === "in-inventory" ? IN_INVENTORY_WORDS : TRASHED_WORDS

/** A gate's refusal, as the host answers it; `nameOf` names the archiver. */
export function gateRefusal(
  refusal: GateRefusal,
  /** Each participant's display name as set; one unset is read from the writer. */
  names: ReadonlyMap<WriterId, string>,
): Refusal {
  const nameOf = (writer: WriterId): string =>
    displayName(writer, names.get(writer))
  switch (refusal.kind) {
    case "archived":
      return refused(
        ERR.CANVAS_ARCHIVED,
        `archived by ${nameOf(refusal.canvas.by)}: restore the canvas first`,
      )
    case "not-on-canvas":
      return refused(ERR.REFUSED, notOnCanvasWords(refusal.setAside))
    case "foreign":
      return foreignRefusal(refusal.lane)
  }
}

const commits = (n: number) => (n === 1 ? "1 commit" : `${n} commits`)

/**
 * Why a setup or publish was refused, worded once: the host's answer, and the
 * publish button's title for a publish it would refuse. `record` names the
 * bookmarks, counts and files.
 */
export function acceptedRefusal(
  action: AcceptedAction,
  code: ErrCode,
  record: JjAcceptedRecord,
): string {
  const { publish, published, workingCopy } = record
  switch (code) {
    case ERR.NOT_SET_UP:
      return "set up first"
    case ERR.NO_PUBLISH:
      return `this repo has no ${publish} bookmark to publish to`
    case ERR.NOT_FAST_FORWARD:
      return `${publish} has ${commits(published.ahead)} accepted work doesn't: bring ${published.ahead === 1 ? "it" : "them"} into accepted work in jj first`
    case ERR.WORKING_COPY_CONFLICT: {
      const would = workingCopy.getLatest?.conflicts ?? []
      if (workingCopy.conflicts.files.length > 0)
        return `the working copy has conflicts in ${namesAndMore(workingCopy.conflicts.files, 3)}`
      if (would.length > 0)
        return `bringing the working copy the latest would conflict in ${namesAndMore(would, 3)}`
      return `${commits(workingCopy.conflicts.commits)} of yours ${workingCopy.conflicts.commits === 1 ? "has" : "have"} conflicts`
    }
    default:
      if (action === "setup") return "already set up"
      return workingCopy.behind > 0 &&
        workingCopy.getLatest === null &&
        record.publishCatchesUp
        ? "the working copy shares no commit with accepted work: rebase onto it in jj"
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
  after: JjAcceptedRecord,
): string {
  if (code !== ERR.WORKING_COPY_CONFLICT)
    return acceptedRefusal("publish", code, after)
  const n = after.workingCopy.conflicts.commits
  return `bringing the working copy the latest would leave ${commits(n)} of yours with conflicts`
}

/** Why a blob makes no image, as its sender is answered. */
export function imageRefusal(why: ImageRefusal): Outcome {
  switch (why.kind) {
    case "missing":
      return refused(ERR.IMAGE_MISSING, `no blob is stored as ${why.sha256}`)
    case "not-an-image":
      return refused(ERR.NOT_AN_IMAGE, "only images go in a media column")
  }
}

/** Why a spin-off started no thread, as its sender is answered. */
export function spinOffRefusal(why: "blank" | "root-in-use"): Outcome {
  switch (why) {
    case "blank":
      return refused(ERR.REFUSED, "nothing in the card to start a thread with")
    case "root-in-use":
      return refused(ERR.ROOT_ID_IN_USE, "that root's id is in use")
  }
}

/** Why an opening was refused, as its sender is answered. */
export function openRefusal(
  why: Extract<OpenPlan, { kind: "refused" }>["why"],
): Outcome {
  switch (why) {
    case "unknown":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such entry, or no such canvas, to branch in",
      }
    case "taken":
      return {
        kind: "refused",
        code: ERR.THREAD_TAKEN,
        message: "that thread has started already",
      }
    default:
      return { kind: "unmoved", code: why, place: null, by: null }
  }
}

/** Why a press on a proposal was refused, as its sender is answered. */
export function branchOutRefusal(why: BranchOutRefusal): Outcome {
  switch (why) {
    case "no-proposal":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no proposal at that entry",
      }
    case "running":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "the run that proposed these has not ended",
      }
    case "spent":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "someone has already opened these branches",
      }
    case "no-row":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "the proposal has no such row",
      }
    default:
      return openRefusal(why)
  }
}

/** Why a copy was refused, as its sender is answered. */
export function copyRefusal(
  why: Extract<CopyPlan, { kind: "refused" }>["why"],
): Outcome {
  switch (why) {
    case "unknown":
      return {
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such thread, or no such end of it, to copy",
      }
    case "taken":
      return {
        kind: "refused",
        code: ERR.THREAD_TAKEN,
        message: "that copy's thread has started already",
      }
    case "in-others-inventory":
      return {
        kind: "refused",
        code: ERR.REFUSED,
        message: "that thread is in someone else's inventory",
      }
    default:
      return { kind: "unmoved", code: why, place: null, by: null }
  }
}
