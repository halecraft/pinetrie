// agent-commands — the commands an agent calls as tools (ADR-0080): when
// `catch_up` may merge and `split_offer` may queue, and what each answers. Each decides from the state of
// what it acts on (the lane's copy, its base, its parent), never from how the
// run began, so a refusal names something true the agent can change.

import {
  CATCH_UP_TOOL,
  type CardRecord,
  type CatchUpCommand,
  type CommitId,
  type CopyFacts,
  commandOf,
  type Position,
  type TextCardId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { type CatchUpNow, type ParentNow, parentAhead } from "./base.ts"
import type { LandMessage } from "./land.ts"
import type { PlaceStep } from "./moves.ts"
import type { OfferStatus } from "./offer.ts"
import { orderAfter } from "./order.ts"
import { queuedOn } from "./queue.ts"
import type { UpdateMessage } from "./update.ts"

/** What a host tool answers the agent: its text, whether it refused, and what it says as a fact. */
export interface ToolAnswer {
  readonly text: string
  readonly isError: boolean
  /** A clean or conflicted merge: what was merged, for `parentNow` and the turn's record. */
  readonly details: { readonly merged: readonly CommitId[] } | null
}

/** Why `catch_up` did not merge. */
export type CatchUpRefusal =
  /** Another call is in the same batch: a sibling's edit would leave the copy (S103 item 2). */
  | "alone"
  /** The base, or the parent, has nothing the copy lacks. */
  | "nothing-new"
  /** The thread works in the person's files, or in no lane: there is no copy to merge into. */
  | "no-copy"
  /** The working copy is not on the thread's own line: a split's stack, or a merge. */
  | "off-line"
  /** The lane's repo has no bookmark of the lane's: nothing to say where its line is. */
  | "no-bookmark"
  /** The thread did not branch from another thread's copy. */
  | "no-parent"
  /** The thread it branched from is working: its copy moves with every turn. */
  | "parent-running"
  /** The base cannot be merged now: the update says why. */
  | { readonly reason: string }

/** `catch_up`'s refusals, worded once, each saying what to do. */
export function catchUpRefusal(code: CatchUpRefusal): string {
  if (typeof code !== "string") return `Not caught up: ${code.reason}.`
  switch (code) {
    case "alone":
      return `Not caught up: call \`${CATCH_UP_TOOL}\` alone in its turn, with no other tool call beside it.`
    case "nothing-new":
      return "Nothing new: this copy already has everything there."
    case "no-copy":
      return "This thread has no copy of its own to merge into."
    case "off-line":
      return "Not caught up: your working copy is not on this thread's own line (a split's stack?). Return to this thread's tip first."
    case "no-bookmark":
      return "Not caught up: this thread's copy has lost its bookmark."
    case "no-parent":
      return "This thread did not branch from another thread's copy."
    case "parent-running":
      return "The thread this one branched from is working: catch up when its run ends."
  }
}

/**
 * Whether `catch_up` merges, and with which command, from the document's
 * facts, before anything is queued: a lane of its own, the only call in its
 * turn, and new work in what it merges. From the base, `brings`, or a move
 * or a lane the host has not read, which the merge's own read decides
 * (`unknown`, S97); from the parent, one ahead and idle. Pure.
 */
export function planCatchUpCall(input: {
  readonly from: "base" | "parent"
  readonly own: boolean
  /** The calls in the turn's assistant message. */
  readonly calls: number
  readonly base: CatchUpNow
  readonly parent: ParentNow | null
  readonly parentRunning: boolean
}):
  | { readonly kind: "merge"; readonly command: CatchUpCommand }
  | { readonly kind: "refused"; readonly why: CatchUpRefusal } {
  const refused = (why: CatchUpRefusal) => ({ kind: "refused", why }) as const
  if (!input.own) return refused("no-copy")
  if (input.calls !== 1) return refused("alone")
  if (input.from === "parent") {
    if (input.parent === null) return refused("no-parent")
    if (input.parentRunning) return refused("parent-running")
    return parentAhead(input.parent)
      ? { kind: "merge", command: "catch-up-with-parent" }
      : refused("nothing-new")
  }
  return input.base.kind === "brings" || input.base.kind === "unknown"
    ? { kind: "merge", command: "bring-up-to-date" }
    : refused("nothing-new")
}

/**
 * Whether the lane's copy may take a merge (ADR-0080): `@` on the thread's
 * own line, its one parent the lane's bookmark or the agent's own commit on
 * it (`planTurnCommit`'s rule). Otherwise the merge would land beside where
 * the agent works, as while a split's stack is the working copy. A repo
 * with no bookmark of the lane's has no line to be on, and is refused as
 * that, not as off it: a split is not the cause (S114). Conflicts do not
 * refuse it: catching up is how a conflict the copy came with is settled
 * (ADR-0072). Pure.
 */
export const planCopyReady = (
  copy: CopyFacts,
): "ready" | "off-line" | "no-bookmark" => {
  if (copy.bookmark === null) return "no-bookmark"
  const [parent, ...more] = copy.parents
  return parent !== undefined &&
    more.length === 0 &&
    (parent === copy.bookmark || copy.descends)
    ? "ready"
    : "off-line"
}

/**
 * What `catch_up` answers once it merged: the update's text and what it
 * merged; or, conflicted, the conflicts and the resolution skill, which the
 * agent resolves in the same run. Pure.
 */
export function catchUpAnswer(
  settled:
    | {
        readonly kind: "clean"
        readonly message: UpdateMessage
        readonly merged: CommitId
      }
    | { readonly kind: "conflicted"; readonly message: LandMessage }
    | { readonly kind: "nothing" },
): ToolAnswer {
  switch (settled.kind) {
    case "clean":
      return {
        text: settled.message.content,
        isError: false,
        details: { merged: [settled.merged] },
      }
    case "conflicted":
      return {
        text: settled.message.content,
        isError: false,
        details: { merged: [...settled.message.details.yours] },
      }
    case "nothing":
      return refusedAnswer("nothing-new")
  }
}

/** A refusal as `catch_up` answers it. */
export const refusedAnswer = (why: CatchUpRefusal): ToolAnswer => ({
  text: catchUpRefusal(why),
  isError: true,
  details: null,
})

/** Why `split_offer` queued nothing. */
export type SplitRefusal = "no-offer" | "queued" | "splitting"

/** `split_offer`'s refusals, worded once. */
export function splitRefusal(code: SplitRefusal): string {
  switch (code) {
    case "no-offer":
      return "This thread has no offer to split: nothing of its work is offered."
    case "queued":
      return "A split of this thread's offer is already queued."
    case "splitting":
      return "This run is the split."
  }
}

/** What `split_offer` answers once it queued the split. */
export const SPLIT_QUEUED =
  "Queued: the split runs when this run ends, as a run of its own."

/**
 * Whether `split_offer` queues a split (ADR-0080), from any run: an open
 * offer to split, none queued, and no split running. A card waits for the
 * run's end, so queueing one touches nothing in the run. The card carries
 * the `split` command and no text, queued after the lane's last card by the
 * person behind the run (`promptAuthor`). Pure.
 */
export function planSplitCall(input: {
  readonly offer: OfferStatus
  readonly cards: readonly CardRecord[]
  readonly lane: ThreadId
  /** The role of the lane's latest prompt, and whether it runs. */
  readonly prompt: string | undefined
  readonly running: boolean
  readonly by: WriterId
  readonly id: TextCardId
  readonly at: Position
}):
  | { readonly kind: "queue"; readonly step: PlaceStep }
  | { readonly kind: "refused"; readonly why: SplitRefusal } {
  if (input.offer.kind !== "open") return { kind: "refused", why: "no-offer" }
  if (input.running && input.prompt === "stack")
    return { kind: "refused", why: "splitting" }
  const queued = queuedOn(input.cards, input.lane)
  if (queued.some(c => commandOf(c) === "split"))
    return { kind: "refused", why: "queued" }
  return {
    kind: "queue",
    step: {
      kind: "write",
      record: {
        kind: "text",
        id: input.id,
        owner: input.by,
        place: {
          kind: "queued",
          at: input.at,
          thread: input.lane,
          order: orderAfter(queued),
          by: input.by,
          seen: "",
        },
        placer: input.by,
        carries: { kind: "message", command: "split" },
        unsent: null,
      },
    },
  }
}
