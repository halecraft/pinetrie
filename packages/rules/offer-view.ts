// offer-view — a lane's offer as the page shows it. It writes no words: they
// are the client's (`offerWords`).

import {
  type AcceptsInto,
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
  type FollowedBase,
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
 * moves a thread whose WIP is gone to accepted work.
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
 * states), and the facts its words are made from. The words are the client's
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
  /** Of those, the ones drawn disabled: they would change nothing now, or cannot yet be done; each one's title says which. */
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
   * The thread's base, as it is brought up to date and accepted into: its
   * WIP, or accepted work once the WIP landed or for a thread on accepted work.
   */
  readonly base: ThreadBase
  /** Where an acceptance goes, for titles; null for a jj project's before its record is read. */
  readonly into: AcceptsInto | null
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** An accepted-offer commit of this thread names no source: nothing is offered until it catches up. */
  readonly untraced: boolean
  /** Where its conflict comes from (`conflictCause`); `work` with none. */
  readonly conflictCause: ConflictCause
  /** The thread this one branched from, while it is ahead of what this lane last caught up with. */
  readonly parent: ParentThread | null
  /** That parent's newest commit holds every file of the offer's conflict resolved. */
  readonly parentResolves: boolean
}

/**
 * Where an offer's conflict comes from: `start` when it conflicts, and every
 * file it conflicts in was already conflicted where it starts, so the
 * conflict came with the lane's copy; else `work`. A folder offer starts on
 * accepted work, which in a folder project holds no conflict.
 */
export function conflictCause(record: OfferRecord): ConflictCause {
  if (record.kind === "folder") return "work"
  const at = new Set(record.startConflicts)
  return record.conflicts.length > 0 && record.conflicts.every(f => at.has(f))
    ? "start"
    : "work"
}

/**
 * The offer's state and buttons. `asked` is when the agent last asked about
 * a conflict on the thread's path (`conflictAskedAt`); it asks for
 * you only when newer than the offer. `base` is the lane's
 * (`pinetrie.base`), null before the host read it, as accepted work; `into`
 * and `wipAhead` come from accepted work's record. A jj offer's acceptance is
 * offered only with a destination (`offerAcceptanceDestinations`); a folder
 * offer's is drawn disabled until accepting into a folder is built.
 */
export function offerView(input: {
  readonly offer: OfferStatus
  readonly activity: Exclude<OfferActivity, "catch-up">
  readonly asked: number | null
  readonly base: FollowedBase | null
  /** Null for a jj project whose accepted work is not read yet: nothing to accept into. */
  readonly into: AcceptsInto | null
  readonly wipAhead: number
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** Accepted-offer commits of this thread that name no source (`BaseRecord.untraced`). */
  readonly untraced: boolean
  /**
   * The commands of the cards queued on its lane: a catch-up makes the offer
   * busy; a split quiets the split button.
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
  const jjOpen = open?.kind === "jj" ? open : undefined
  const jjBase = input.base?.kind === "jj" ? input.base : null
  const ahead =
    input.parent !== null && parentAhead(input.parent) ? input.parent : null
  const cause: ConflictCause = open === undefined ? "work" : conflictCause(open)
  const parentResolves =
    ahead !== null &&
    open?.conflicts.every(f => !ahead.conflicts.includes(f)) === true
  const facts: OfferFacts = {
    activity,
    files: open?.files.length ?? 0,
    // A folder offer is one change: never a stack.
    size: open === undefined ? 0 : (jjOpen?.size ?? 1),
    conflicts: open?.conflicts.length ?? 0,
    touchesYourEdits: (jjOpen?.yourEdits.length ?? 0) > 0,
    bookmark: notYetAccepted?.kind === "jj" ? notYetAccepted.bookmark : null,
    held: offer.kind === "held",
    acceptedAs: offer.kind === "accepted" ? offer.as : null,
    base: effectiveBase(input.base),
    into: input.into,
    catchUp: input.catchUp,
    untraced: input.untraced,
    conflictCause: cause,
    parent: ahead,
    parentResolves,
  }
  const { into } = input
  const destinations =
    open === undefined || into?.kind !== "bookmark"
      ? []
      : offerAcceptanceDestinations({
          base: jjBase?.base ?? { kind: "accepted" },
          state: jjBase?.state ?? "ok",
          acceptedBookmark: into.bookmark,
          conflicted: open.conflicts.length > 0,
          wipAhead: input.wipAhead,
        })
  const gone = jjBase?.state === "gone"
  // A folder offer's accept stays, disabled: accepting into a folder
  // project is not built yet, and its title says so.
  const later = into?.kind === "folder"
  const integrable = (
    buttons: readonly OfferButton[],
  ): readonly OfferButton[] =>
    destinations.length === 0 && !later
      ? buttons.filter(b => b !== "accept")
      : buttons
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
    // already stands beside the offer.
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
      // A split already waits in the queue.
      ...(input.queued.includes("split") ? (["split"] as const) : []),
      ...(later && buttons.includes("accept") ? (["accept"] as const) : []),
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
  if (record.kind === "jj" && record.edited)
    return view("edited", ["accept", "refresh"], ["update"])
  // A conflict that came with the lane's copy, which the parent has since
  // resolved, is settled by catching up with the parent; any other by
  // catching up with the base and resolving.
  if (record.conflicts.length > 0)
    return view(
      "conflicts",
      cause === "start" && parentResolves
        ? ["catch-up-parent", "accept"]
        : ["update", "accept"],
      [],
    )
  // A folder offer is its files: never split, never a stack.
  if (record.kind === "folder")
    return view("ready", ["accept"], ["describe", "update"])
  if (record.size > 1)
    return record.stale
      ? view("stale", ["split", "accept"], ["update"])
      : view("stack", ["accept", "squash"], ["update"])
  return view("ready", ["accept", "split"], ["describe", "update"])
}

/**
 * What an acceptance was shown, from the record the page drew: the
 * offer's ledger, and whether it conflicted. With no record, it was shown no
 * offer.
 */
export const offerSeen = (record: OfferRecord | undefined): OfferSeen => ({
  ledger: record?.kind === "jj" ? record.ledger : null,
  conflicted: (record?.conflicts.length ?? 0) > 0,
})
