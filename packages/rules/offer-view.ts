// offer-view — a lane's offer as the page shows it (ADR-0038): its state,
// its buttons and menu, and the facts its words are made from
// (`offerView`), from the record (`offerStatus`), the line's and the base's
// records (`catchUpOf`, `line.ts`) and the thread it branched from
// (ADR-0072). It writes no words: they are the client's (`offerWords`,
// ADR-0040).

import type {
  BaseRecord,
  ConflictCause,
  LandingRecord,
  OfferRecord,
  OfferSeen,
  ParentThread,
  ThreadBase,
} from "@pineta/core"
import {
  type CatchUpNow,
  effectiveBase,
  type ParentNow,
  parentAhead,
} from "./line.ts"
import {
  type OfferIntegrationDestination,
  type OfferStatus,
  offerIntegrationDestinations,
} from "./offer.ts"

/**
 * A button beside the offer, or in its menu. `integrate` integrates it into
 * its default destination; `integrate-into-line` into the line, from a WIP
 * thread; `continue`
 * moves a thread whose WIP is gone to the line (ADR-0060).
 */
export type OfferButton =
  | "integrate"
  | "integrate-into-line"
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
 * One state of a lane's offer, what can be done in it (ADR-0038's table), and
 * the facts its words are made from. The words are the client's
 * (`offerWords`, `@pineta/client`).
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
    | "integrated"
  /** Buttons beside the offer, the first the primary one. */
  readonly buttons: readonly OfferButton[]
  /** Buttons in the offer's menu. */
  readonly menu: readonly OfferButton[]
  /** Of those, the ones that would change nothing now: drawn, but disabled. */
  readonly quiet: readonly OfferButton[]
  /** Where `integrate` (the first) and `integrate-into-line` (the line, from a WIP) go. */
  readonly destinations: readonly OfferIntegrationDestination[]
  readonly facts: OfferFacts
}

/** What an offer's words are made from. */
interface OfferFacts {
  readonly activity: OfferActivity
  /** Files in the offer not yet integrated; 0 with none. */
  readonly files: number
  /** Revisions in the offer not yet integrated: more than one is a stack. */
  readonly size: number
  /** Files that conflict with your work. */
  readonly conflicts: number
  /** It touches files you have uncommitted edits in. */
  readonly touchesYourEdits: boolean
  /** Its bookmark, to find it in jj; null with no offer not yet integrated. */
  readonly bookmark: string | null
  /** An offer not yet integrated whose work the line already holds (`held`). */
  readonly held: boolean
  /** The change id it was integrated as, or null. */
  readonly integratedAs: string | null
  /**
   * The thread's base, as it is brought up to date and integrated into (ADR-0060): its
   * WIP, or the line once the WIP landed or for a line thread.
   */
  readonly base: ThreadBase
  /** The line's bookmark, for titles. */
  readonly onto: string
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** An integrated-offer commit of this thread names no source: nothing is offered until it catches up (S97). */
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
 * The offer's state and buttons. `landing` is the lane's latest resolution;
 * it asks for you only when newer than the offer. `base` is the lane's
 * (`pineta.base`), null before the host read it, as the line; `onto` and
 * `wipAhead` come from the line's record. An integration is offered only with a
 * destination (`offerIntegrationDestinations`).
 */
export function offerView(input: {
  readonly offer: OfferStatus
  readonly activity: Exclude<OfferActivity, "catch-up">
  readonly landing: LandingRecord | undefined
  readonly base: Pick<BaseRecord, "base" | "state"> | null
  readonly onto: string
  readonly wipAhead: number
  /** What catching up would do (`catchUpOf`). */
  readonly catchUp: CatchUpNow
  /** Integrated-offer commits of this thread that name no source (`BaseRecord.untraced`). */
  readonly untraced: boolean
  /** A card bringing the thread up to date is queued on its lane. */
  readonly catchingUp: boolean
  /** The thread this one branched from (`parentNow`); null for one that began at its base. */
  readonly parent: ParentNow | null
  /** That thread's agent runs: its copy moves with every turn. */
  readonly parentRunning: boolean
}): OfferView {
  const { offer, landing } = input
  const activity: OfferActivity =
    input.activity === "idle" && input.catchingUp ? "catch-up" : input.activity
  const notYetIntegrated =
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
    bookmark: notYetIntegrated?.bookmark ?? null,
    held: offer.kind === "held",
    integratedAs: offer.kind === "integrated" ? offer.as : null,
    base: effectiveBase(input.base),
    onto: input.onto,
    catchUp: input.catchUp,
    untraced: input.untraced,
    conflictCause: cause,
    parent: ahead,
    parentResolves,
  }
  const destinations =
    open === undefined
      ? []
      : offerIntegrationDestinations({
          base: input.base?.base ?? { kind: "line" },
          state: input.base?.state ?? "ok",
          onto: input.onto,
          conflicted: open.conflicts.length > 0,
          wipAhead: input.wipAhead,
        })
  const gone = input.base?.state === "gone"
  const integrable = (
    buttons: readonly OfferButton[],
  ): readonly OfferButton[] =>
    destinations.length === 0 ? buttons.filter(b => b !== "integrate") : buttons
  const view = (
    state: OfferView["state"],
    buttons: readonly OfferButton[],
    listed: readonly OfferButton[],
  ): OfferView => {
    // A thread whose WIP is gone is brought up to date only by moving it to
    // the line.
    const toLine = (bs: readonly OfferButton[]) =>
      gone ? bs.map(b => (b === "update" ? "continue" : b)) : bs
    // While the parent is ahead, catching up with it is listed, unless it
    // already stands beside the offer (ADR-0072).
    const menu = [
      ...toLine(listed),
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
    ]
    // An untraced start rebuilds nothing: only your edited offer is left.
    const rebuilds = (b: OfferButton) =>
      !input.untraced || (b !== "refresh" && b !== "squash" && b !== "split")
    return {
      state,
      buttons: integrable(toLine(shown.buttons)).filter(rebuilds),
      menu: [
        ...shown.menu.filter(rebuilds),
        ...(destinations.length > 1 ? (["integrate-into-line"] as const) : []),
      ],
      quiet,
      destinations,
      facts,
    }
  }
  if (activity === "turn") return view("running", [], [])
  if (activity !== "idle") return view("busy", [], [])
  if (offer.kind === "none") return view("nothing", [], ["update"])
  if (offer.kind === "integrated") return view("integrated", [], ["update"])
  const { record } = offer
  if (landing?.state === "needs_you" && landing.at > record.at)
    return view("needs_you", ["integrate"], ["update"])
  if (offer.kind === "held") return view("nothing", [], ["update"])
  if (record.edited) return view("edited", ["integrate", "refresh"], ["update"])
  // A conflict that came with the lane's copy, which the parent has since
  // resolved, is settled by catching up with the parent; any other by
  // catching up with the base and resolving (ADR-0072).
  if (record.conflicts.length > 0)
    return view(
      "conflicts",
      cause === "start" && parentResolves
        ? ["catch-up-parent", "integrate"]
        : ["update", "integrate"],
      [],
    )
  if (record.size > 1)
    return record.stale
      ? view("stale", ["split", "integrate"], ["update"])
      : view("stack", ["integrate", "squash"], ["update"])
  return view("ready", ["integrate", "split"], ["describe", "update"])
}

/**
 * What an offer integration was shown (ADR-0065), from the record the page drew: the
 * offer's ledger, and whether it conflicted. With no record, it was shown no
 * offer.
 */
export const offerSeen = (record: OfferRecord | undefined): OfferSeen => ({
  ledger: record?.ledger ?? null,
  conflicted: (record?.conflicts.length ?? 0) > 0,
})
