// offer-view — a lane's offer as the page shows it (ADR-0105): its state,
// its buttons and menu, and the facts its words are made from
// (`offerView`), from the record (`offerStatus`), accepted work's and the base's
// records (`catchUpOf`, `line.ts`) and the thread it branched from
// (ADR-0072). It writes no words: they are the client's (`offerWords`,
// ADR-0040).

import {
  type BaseRecord,
  type CardCommand,
  type ConflictCause,
  isCatchUp,
  type OfferRecord,
  type OfferSeen,
  type ParentThread,
  type ThreadBase,
} from "@pinetrie/core"
import {
  type CatchUpNow,
  effectiveBase,
  type ParentNow,
  parentAhead,
} from "./base.ts"
import {
  type OfferAcceptanceDestination,
  type OfferStatus,
  offerAcceptanceDestinations,
} from "./offer.ts"

/**
 * A button beside the offer, or in its menu. `accept` accepts it into
 * its default destination; `accept-into-accepted` into accepted work, from a WIP
 * thread; `continue`
 * moves a thread whose WIP is gone to accepted work (ADR-0104).
 */
export type OfferButton =
  | "accept"
  | "accept-into-accepted"
  | "continue"
  | "split"
  | "squash"
  | "describe"
  | "refresh"
  | "update"
  | "catch-up-parent"

/**
 * What the lane is running now, as far as the offer cares; `catch-up`: a
 * card that brings it up to date is queued, and popped before anything else.
 */
export type OfferActivity =
  | "idle"
  | "turn"
  | "resolution"
  | "split"
  | "catch-up"

/**
 * One state of a lane's offer, what can be done in it (the work strip's
 * states, ADR-0105), and the facts its words are made from. The words are the client's
 * (`offerWords`, `@pinetrie/interface`).
 */
export interface OfferView {
  readonly state:
    | "nothing"
    | "running"
    | "busy"
    | "needs_you"
    | "conflicts"
    | "ready"
    | "stack"
    | "stale"
    | "edited"
    | "accepted"
  /** Buttons beside the offer, the first the primary one. */
  readonly buttons: readonly OfferButton[]
  /** Buttons in the offer's menu. */
  readonly menu: readonly OfferButton[]
  /** Of those, the ones that would change nothing now: drawn, but disabled. */
  readonly quiet: readonly OfferButton[]
  /** Where `accept` (the first) and `accept-into-accepted` (accepted work, from a WIP) go. */
  readonly destinations: readonly OfferAcceptanceDestination[]
  readonly facts: OfferFacts
}

/** What an offer's words are made from. */
interface OfferFacts {
  readonly activity: OfferActivity
  /** Files in the offer not yet accepted; 0 with none. */
  readonly files: number
  /** Revisions in the offer not yet accepted: more than one is a stack. */
  readonly size: number
  /** Files that conflict with your work. */
  readonly conflicts: number
  /** It touches files you have uncommitted edits in. */
  readonly touchesYourEdits: boolean
  /** Its bookmark, to find it in jj; null with no offer not yet accepted. */
  readonly bookmark: string | null
  /** An offer not yet accepted whose work accepted work already holds (`held`). */
  readonly held: boolean
  /** The change id it was accepted as, or null. */
  readonly acceptedAs: string | null
  /**
   * The thread's base, as it is brought up to date and accepted into (ADR-0104): its
   * WIP, or accepted work once the WIP landed or for a thread on accepted work.
   */
  readonly base: ThreadBase
  /** Accepted work's bookmark, for titles. */
  readonly acceptedBookmark: string
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** An accepted-offer commit of this thread names no source: nothing is offered until it catches up (S97). */
  readonly untraced: boolean
  /** Where its conflict comes from (`conflictCause`); `work` with none. */
  readonly conflictCause: ConflictCause
  /** The thread this one branched from, while it is ahead of what this lane last caught up with (ADR-0072). */
  readonly parent: ParentThread | null
  /** That parent's newest commit holds every file of the offer's conflict resolved. */
  readonly parentResolves: boolean
}

/**
 * Where an offer's conflict comes from: `start` when it conflicts, and every
 * file it conflicts in was already conflicted where it starts, so the
 * conflict came with the lane's copy; else `work` (ADR-0072). Pure.
 */
export function conflictCause(
  record: Pick<OfferRecord, "conflicts" | "startConflicts">,
): ConflictCause {
  const at = new Set(record.startConflicts)
  return record.conflicts.length > 0 && record.conflicts.every(f => at.has(f))
    ? "start"
    : "work"
}

/**
 * The offer's state and buttons. `asked` is when the agent last asked about
 * a conflict on the thread's path (`conflictAskedAt`, ADR-0080); it asks for
 * you only when newer than the offer. `base` is the lane's
 * (`pinetrie.base`), null before the host read it, as accepted work; `acceptedBookmark` and
 * `wipAhead` come from accepted work's record. An acceptance is offered only with a
 * destination (`offerAcceptanceDestinations`).
 */
export function offerView(input: {
  readonly offer: OfferStatus
  readonly activity: Exclude<OfferActivity, "catch-up">
  readonly asked: number | null
  readonly base: Pick<BaseRecord, "base" | "state"> | null
  readonly acceptedBookmark: string
  readonly wipAhead: number
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** Accepted-offer commits of this thread that name no source (`BaseRecord.untraced`). */
  readonly untraced: boolean
  /**
   * The commands of the cards queued on its lane: a catch-up makes the offer
   * busy; a split quiets the split button (ADR-0080).
   */
  readonly queued: readonly CardCommand[]
  /** The thread this one branched from (`parentNow`); null for one that began at its base. */
  readonly parent: ParentNow | null
  /** That thread's agent runs: its copy moves with every turn. */
  readonly parentRunning: boolean
}): OfferView {
  const { offer, asked } = input
  const activity: OfferActivity =
    input.activity === "idle" && input.queued.some(isCatchUp)
      ? "catch-up"
      : input.activity
  const notYetAccepted =
    offer.kind === "open" || offer.kind === "held" ? offer.record : undefined
  const open = offer.kind === "open" ? offer.record : undefined
  const ahead =
    input.parent !== null && parentAhead(input.parent) ? input.parent : null
  const cause: ConflictCause = open === undefined ? "work" : conflictCause(open)
  const parentResolves =
    ahead !== null &&
    open?.conflicts.every(f => !ahead.conflicts.includes(f)) === true
  const facts: OfferFacts = {
    activity,
    files: open?.files.length ?? 0,
    size: open?.size ?? 0,
    conflicts: open?.conflicts.length ?? 0,
    touchesYourEdits: (open?.yourEdits.length ?? 0) > 0,
    bookmark: notYetAccepted?.bookmark ?? null,
    held: offer.kind === "held",
    acceptedAs: offer.kind === "accepted" ? offer.as : null,
    base: effectiveBase(input.base),
    acceptedBookmark: input.acceptedBookmark,
    catchUp: input.catchUp,
    untraced: input.untraced,
    conflictCause: cause,
    parent: ahead,
    parentResolves,
  }
  const destinations =
    open === undefined
      ? []
      : offerAcceptanceDestinations({
          base: input.base?.base ?? { kind: "accepted" },
          state: input.base?.state ?? "ok",
          acceptedBookmark: input.acceptedBookmark,
          conflicted: open.conflicts.length > 0,
          wipAhead: input.wipAhead,
        })
  const gone = input.base?.state === "gone"
  const integrable = (
    buttons: readonly OfferButton[],
  ): readonly OfferButton[] =>
    destinations.length === 0 ? buttons.filter(b => b !== "accept") : buttons
  const view = (
    state: OfferView["state"],
    buttons: readonly OfferButton[],
    listed: readonly OfferButton[],
  ): OfferView => {
    // A thread whose WIP is gone is brought up to date only by moving it to
    // accepted work.
    const toAccepted = (bs: readonly OfferButton[]) =>
      gone ? bs.map(b => (b === "update" ? "continue" : b)) : bs
    // While the parent is ahead, catching up with it is listed, unless it
    // already stands beside the offer (ADR-0072).
    const menu = [
      ...toAccepted(listed),
      ...(ahead !== null && !buttons.includes("catch-up-parent")
        ? (["catch-up-parent"] as const)
        : []),
    ]
    // When it brings work, or must come before any offer, catching up
    // stands beside the offer; when it would change nothing, it is quiet.
    const { kind } = input.catchUp
    const shown =
      (kind === "brings" || input.untraced) && menu.includes("update")
        ? {
            buttons: [...buttons, "update" as const],
            menu: menu.filter(b => b !== "update"),
          }
        : { buttons, menu }
    const quiet: OfferButton[] = [
      ...(!input.untraced && (kind === "current" || kind === "nothing-new")
        ? (["update"] as const).filter(b => shown.menu.includes(b))
        : []),
      // The parent's copy moves with every turn: not while it runs.
      ...(ahead !== null && input.parentRunning
        ? (["catch-up-parent"] as const)
        : []),
      // A split already waits in the queue (ADR-0080).
      ...(input.queued.includes("split") ? (["split"] as const) : []),
    ]
    // An untraced start rebuilds nothing: only your edited offer is left.
    const rebuilds = (b: OfferButton) =>
      !input.untraced || (b !== "refresh" && b !== "squash" && b !== "split")
    return {
      state,
      buttons: integrable(toAccepted(shown.buttons)).filter(rebuilds),
      menu: [
        ...shown.menu.filter(rebuilds),
        ...(destinations.length > 1 ? (["accept-into-accepted"] as const) : []),
      ],
      quiet,
      destinations,
      facts,
    }
  }
  if (activity === "turn") return view("running", [], [])
  if (activity !== "idle") return view("busy", [], [])
  if (offer.kind === "none") return view("nothing", [], ["update"])
  if (offer.kind === "accepted") return view("accepted", [], ["update"])
  const { record } = offer
  if (asked !== null && asked > record.at)
    return view("needs_you", ["accept"], ["update"])
  if (offer.kind === "held") return view("nothing", [], ["update"])
  if (record.edited) return view("edited", ["accept", "refresh"], ["update"])
  // A conflict that came with the lane's copy, which the parent has since
  // resolved, is settled by catching up with the parent; any other by
  // catching up with the base and resolving (ADR-0072).
  if (record.conflicts.length > 0)
    return view(
      "conflicts",
      cause === "start" && parentResolves
        ? ["catch-up-parent", "accept"]
        : ["update", "accept"],
      [],
    )
  if (record.size > 1)
    return record.stale
      ? view("stale", ["split", "accept"], ["update"])
      : view("stack", ["accept", "squash"], ["update"])
  return view("ready", ["accept", "split"], ["describe", "update"])
}

/**
 * What an acceptance was shown (ADR-0065), from the record the page drew: the
 * offer's ledger, and whether it conflicted. With no record, it was shown no
 * offer.
 */
export const offerSeen = (record: OfferRecord | undefined): OfferSeen => ({
  ledger: record?.ledger ?? null,
  conflicted: (record?.conflicts.length ?? 0) > 0,
})
