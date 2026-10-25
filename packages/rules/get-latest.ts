// get-latest — a thread's base, or the thread it branched from, merged into
// its lane, decided: whether a merge may go ahead and the floor its
// resolution's prompt must fit (`planGetLatest`), what the merge comes to for
// the thread (`planSettle`), and `catch_up` in two phases around the merge
// (`planLatestInRun`, `planLatestInRunAnswer`).

import {
  type BaseMerge,
  type CopyRefusal,
  type EntryId,
  ERR,
  entryOfMessage,
  firstLine,
  type LatestFrom,
  type MergeSource,
  type PointId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type GetLatestCommand,
  messageText,
  messageToolCalls,
  type TreeIndex,
  turnEntry,
} from "@pinetrie/threads"
import type { AcceptedRecord } from "./accepted.ts"
import {
  getLatestAnswer,
  planGetLatestCall,
  refusedAnswer,
  type ToolAnswer,
} from "./agent-commands.ts"
import {
  type BaseRecord,
  latestNow,
  type ParentNow,
  updateRefusal,
} from "./base.ts"
import {
  type Floor,
  type LandMessage,
  type LandSkill,
  type PromptBudget,
  planResolution,
  resolutionFloor,
} from "./land.ts"
import { latestSourceName, latestWords, mergedFrom } from "./latest-from.ts"
import { removalsText, type StaleRemoval } from "./removals.ts"
import { encodeUpdate, type UpdateMessage } from "./update.ts"

/**
 * Why a catch-up was refused before it merged: the smallest resolution prompt
 * for it would not fit what a run keeps when pi compacts.
 */
function unfittableWords(tokens: number, budget: number): string {
  return `a resolution's prompt would need ${tokens} tokens, over the ${budget} a run keeps: shorten the card's text or the resolve-conflicts skill`
}

/** What a resolution's prompt must fit, read before a merge. */
export interface Resolution {
  readonly budget: PromptBudget
  readonly skill: LandSkill | null
  readonly intent: string
}

/**
 * The floor a resolution's prompt must fit for a merge from `latest`, whose
 * wording is part of it; refused when even the smallest prompt would not
 * fit what a run keeps.
 */
function latestResolutionFloor(
  latest: LatestFrom,
  resolution: Resolution,
):
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "floor"; readonly floor: Floor } {
  const found = resolutionFloor({ ...resolution, latest: latestWords(latest) })
  return found.kind === "too-large"
    ? { kind: "refused", reason: unfittableWords(found.tokens, found.budget) }
    : { kind: "floor", floor: found.floor }
}

/**
 * What a catch-up may do once its base is known: merge, with the floor its
 * resolution's prompt will fit, or refuse with the lane untouched, when even
 * the smallest prompt would not fit. Decided before the merge: a merge left
 * without a prompt is one the agent's `catch_up` never merges again, and
 * only a card's catch-up re-plans it (`planUnresolvedMerge`).
 */
export function planGetLatest(
  from: BaseMerge,
  resolution: Resolution,
):
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "merge"
      readonly from: BaseMerge
      readonly floor: Floor
    } {
  const found = latestResolutionFloor(mergedFrom(from), resolution)
  return found.kind === "refused"
    ? found
    : { kind: "merge", from, floor: found.floor }
}

/**
 * A conflicted merge the lane still holds, as its history found it again
 * (`LaneHistory.unresolvedMerge`, `@pinetrie/lanes`), read by its shape.
 */
interface UnresolvedMerge {
  readonly from: PointId
  readonly contents: readonly {
    readonly path: string
    readonly content: string
  }[]
  readonly ours: readonly TouchedRevision[]
  readonly theirs: readonly TouchedRevision[]
  readonly source: MergeSource
}

/**
 * A conflicted merge the lane still holds, resolved again with nothing
 * merged: named by where it came from, never by the command that asked, the
 * thread it branched from by its lane and name now (`parent`), and with the
 * floor settled for that name. Refused when that thread is no longer known,
 * or when even the smallest prompt would not fit. Nothing merged, so no
 * stale outputs went.
 */
export function planUnresolvedMerge(input: {
  readonly merge: UnresolvedMerge
  readonly parent: ParentNow | null
  readonly resolution: Resolution
}):
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "merged"
      readonly from: LatestFrom
      readonly facts: SettleFacts
    } {
  const { merge, parent } = input
  const { source, ...facts } = merge
  const from: LatestFrom | null =
    source.kind !== "parent"
      ? source
      : parent === null
        ? null
        : { kind: "parent", lane: parent.lane, name: parent.name }
  if (from === null)
    return { kind: "refused", reason: updateRefusal(ERR.PARENT_UNKNOWN) }
  const found = latestResolutionFloor(from, input.resolution)
  if (found.kind === "refused") return found
  return {
    kind: "merged",
    from,
    facts: { kind: "conflicted", ...facts, floor: found.floor, removed: [] },
  }
}

/**
 * Why one side changed a file: the message a revision's trailer names,
 * attributed, else the description's first line.
 */
export function changeReason(index: TreeIndex, description: string): string {
  const entry = entryOfMessage(description)
  const message = entry === null ? undefined : index.entries[entry]?.message
  if (message === undefined) return firstLine(description, 200)
  const who =
    message.role === "person" ? `${message.author ?? "someone"}: ` : "agent: "
  return `${who}${firstLine(messageText(message), 400)}`
}

/** A revision on one side of a merge, and the files it touched of those asked about. */
interface TouchedRevision {
  readonly description: string
  readonly paths: readonly string[]
}

/**
 * What a merge found, with what a resolution's prompt needs when it
 * conflicted, and what getting the latest removed from the disk after it.
 * The shape of a lane history's merge (`@pinetrie/lanes`' `Merged`), as this
 * reads it.
 */
export type SettleFacts = (
  | {
      readonly kind: "nothing"
      readonly ours: PointId
      readonly mark: PointId | null
    }
  | {
      readonly kind: "clean"
      readonly from: PointId
      readonly ours: PointId
      readonly merge: PointId
      readonly files: readonly string[]
      readonly commits: readonly string[]
    }
  | {
      readonly kind: "conflicted"
      readonly from: PointId
      readonly contents: readonly {
        readonly path: string
        readonly content: string
      }[]
      readonly ours: readonly TouchedRevision[]
      readonly theirs: readonly TouchedRevision[]
      /** What the prompt must fit, settled before the merge (`planGetLatest`). */
      readonly floor: Floor
    }
) & { readonly removed: readonly StaleRemoval[] }

/** What the thread gets after a merge. */
export type Settle =
  | {
      readonly kind: "clean"
      readonly message: UpdateMessage
      readonly merge: PointId
    }
  | { readonly kind: "nothing" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }

const touching = (revisions: readonly TouchedRevision[], path: string) =>
  revisions.filter(r => r.paths.includes(path)).map(r => r.description)

/**
 * What a merge comes to. Clean: the update, written in the thread. Nothing:
 * nothing for the thread. Conflicted: the resolution's prompt, within the
 * floor's budget, each file with why each side changed it, and the card's
 * text after. Both messages say what was removed from the disk after the
 * merge. What the merge's adapter does after it is its own
 * (`MergeDone.follow`).
 */
export function planSettle(
  facts: SettleFacts,
  ctx: {
    readonly lane: ThreadId
    readonly by: WriterId
    /** What was merged, which names its side. */
    readonly from: LatestFrom
    readonly index: TreeIndex
    readonly now: number
  },
): Settle {
  const { lane, by, from: upToDate } = ctx
  const removals = removalsText(facts.removed)
  switch (facts.kind) {
    case "nothing":
      return { kind: "nothing" }
    case "clean":
      return {
        kind: "clean",
        message: encodeUpdate(
          {
            lane,
            from: upToDate,
            merged: facts.from,
            files: facts.files,
            commits: facts.commits,
            by,
          },
          ctx.now,
          removals,
        ),
        merge: facts.merge,
      }
    case "conflicted":
      return {
        kind: "conflicted",
        message: planResolution({
          floor: facts.floor,
          files: facts.contents.map(({ path, content }) => ({
            path,
            content,
            ours: {
              label: "ours",
              who: "this thread",
              reasons: touching(facts.ours, path).map(d =>
                changeReason(ctx.index, d),
              ),
            },
            theirs: {
              label: "theirs",
              who:
                upToDate.kind === "parent"
                  ? `the thread ${latestSourceName(upToDate)}`
                  : latestSourceName(upToDate),
              reasons: touching(facts.theirs, path).map(d => firstLine(d, 200)),
            },
          })),
          removals,
          details: { lane, merged: [facts.from], by },
          timestamp: ctx.now,
        }),
      }
  }
}

declare const latestInRunBrand: unique symbol
/**
 * A `catch_up` let through: the command it merges with, for whom. Only
 * `planLatestInRun` makes one, so no answer is planned for a merge no call asked
 * for.
 */
interface LatestInRun {
  readonly kind: "merge"
  readonly lane: ThreadId
  readonly command: GetLatestCommand
  /** The person behind the run: the update is theirs. */
  readonly by: WriterId
  readonly [latestInRunBrand]: true
}

/**
 * Whether the lane's agent's `catch_up` merges (`planGetLatestCall`), from
 * its root's tree as it is now: its lane's tip's turn, the person behind the
 * run, its base and accepted work, and, from the parent, the thread it
 * branched from. Refused for a lane with no copy of its own, or no tree or
 * person behind its run.
 */
export function planLatestInRun(facts: {
  readonly lane: ThreadId
  readonly from: "base" | "parent"
  readonly own: boolean
  readonly index: TreeIndex | null
  readonly tip: EntryId | null
  /** The person behind the run (`readRunAuthor`); null for none. */
  readonly by: WriterId | null
  readonly base: BaseRecord | undefined
  readonly accepted: AcceptedRecord | null
  readonly parent: ParentNow | null
  readonly parentRunning: boolean
}): { readonly kind: "answer"; readonly answer: ToolAnswer } | LatestInRun {
  const { index, by } = facts
  if (!facts.own || index === null || by === null)
    return { kind: "answer", answer: refusedAnswer("no-copy") }
  const call = planGetLatestCall({
    from: facts.from,
    own: true,
    calls:
      facts.tip === null
        ? 0
        : messageToolCalls(index.entries[turnEntry(index, facts.tip)]?.message)
            .length,
    base: latestNow(facts.base, facts.accepted),
    parent: facts.parent,
    parentRunning: facts.parentRunning,
  })
  if (call.kind === "refused")
    return { kind: "answer", answer: refusedAnswer(call.why) }
  return {
    kind: "merge",
    lane: facts.lane,
    command: call.command,
    by,
  } as LatestInRun
}

/** What the merge a `catch_up` asked for came to, on the lane's queue. */
export type LatestInRunDone =
  /** The copy cannot take a merge. */
  | { readonly kind: "copy"; readonly why: CopyRefusal }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "nothing" }
  | {
      readonly kind: "merged"
      /** What was merged, as `planSettle` names it. */
      readonly from: LatestFrom
      readonly facts: SettleFacts
    }

/**
 * `catch_up`'s answer, from the merge `planLatestInRun` let through: the update's
 * text or the conflicts to resolve, worded as the tool's answer; or why
 * nothing merged.
 */
export function planLatestInRunAnswer(
  call: LatestInRun,
  done: LatestInRunDone,
  ctx: { readonly index: TreeIndex; readonly now: number },
): ToolAnswer {
  switch (done.kind) {
    case "copy":
      return refusedAnswer(done.why)
    case "refused":
      return refusedAnswer({ reason: done.reason })
    case "nothing":
      return getLatestAnswer({ kind: "nothing" })
    case "merged": {
      const settle = planSettle(done.facts, {
        lane: call.lane,
        by: call.by,
        from: done.from,
        index: ctx.index,
        now: ctx.now,
      })
      return getLatestAnswer(
        settle.kind === "clean"
          ? { kind: "clean", message: settle.message, merged: settle.merge }
          : settle,
      )
    }
  }
}
