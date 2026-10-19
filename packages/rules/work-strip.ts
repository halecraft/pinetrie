// work-strip — a lane's work strip, as the page shows it: its state, buttons
// and menu, decided from its proposed changes' record. It writes no words: they
// are the client's (`workStripWords`).

import {
  type AcceptsInto,
  type CardCommand,
  type ConflictCause,
  isGetLatest,
  type ParentThread,
  type ProposedChangesRecord,
  type ThreadBase,
} from "@pinetrie/core"
import {
  effectiveBase,
  type FollowedBase,
  type LatestNow,
  type ParentNow,
  parentAhead,
} from "./base.ts"
import {
  type AcceptanceDestination,
  acceptanceDestinations,
  type ProposedChangesStatus,
} from "./proposed.ts"

/**
 * A button beside the proposed changes, or in its menu. `accept` accepts it
 * into its default destination; `accept-into-accepted` into accepted work, from
 * a WIP thread; `continue` moves a thread whose WIP is gone to accepted work.
 */
export type WorkStripButton =
  | "accept"
  | "accept-into-accepted"
  | "continue"
  | "split"
  | "squash"
  | "describe"
  | "refresh"
  | "update"
  | "get-latest-from-parent"
  /** A folder lane's conflicts opened in its pane, each version to choose. */
  | "choose-versions"

/**
 * What the lane is running now, as far as the proposed changes cares;
 * `catch-up`: a card that brings it up to date is queued, and popped before
 * anything else.
 */
export type WorkStripActivity =
  | "idle"
  | "turn"
  | "resolution"
  | "split"
  | "get-latest"

/**
 * One state of a lane's proposed changes, what can be done in it (the work
 * strip's states), and the facts its words are made from. The words are the
 * client's (`workStripWords`, `@pinetrie/interface`).
 */
export interface WorkStripView {
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
  /** Buttons beside the proposed changes, the first the primary one. */
  readonly buttons: readonly WorkStripButton[]
  /** Buttons in the proposed changes' menu. */
  readonly menu: readonly WorkStripButton[]
  /** Of those, the ones drawn disabled: they would change nothing now, or cannot yet be done; each one's title says which. */
  readonly quiet: readonly WorkStripButton[]
  /** Where `accept` (the first) and `accept-into-accepted` (accepted work, from a WIP) go. */
  readonly destinations: readonly AcceptanceDestination[]
  readonly facts: WorkStripFacts
}

/** What proposed changes' words are made from. */
interface WorkStripFacts {
  readonly activity: WorkStripActivity
  /** Files in the proposed changes not yet accepted; 0 with none. */
  readonly files: number
  /** Revisions in the proposed changes not yet accepted: more than one is a stack. */
  readonly size: number
  /** Files that conflict with your work. */
  readonly conflicts: number
  /** It touches files you have uncommitted edits in. */
  readonly touchesWorkingCopyEdits: boolean
  /** Its bookmark, to find it in jj; null with no proposed changes not yet accepted. */
  readonly bookmark: string | null
  /** Proposed changes not yet accepted whose work accepted work already holds (`held`). */
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
  /** What catching up would do (`latestNow`). */
  readonly getLatest: LatestNow
  /** An accepted thread commit of this thread names no source: nothing is proposed until it catches up. */
  readonly untraced: boolean
  /** Where its conflict comes from (`conflictCause`); `work` with none. */
  readonly conflictCause: ConflictCause
  /** The thread this one branched from, while it is ahead of what this lane last caught up with. */
  readonly parent: ParentThread | null
  /** That parent's newest commit holds every file of the proposed changes' conflict resolved. */
  readonly parentResolves: boolean
}

/**
 * Where proposed changes' conflict comes from: `start` when it conflicts, and
 * every file it conflicts in was already conflicted where it starts, so the
 * conflict came with the lane's copy; else `work`. Folder proposed changes
 * start on accepted work, which in a folder project holds no conflict.
 */
export function conflictCause(record: ProposedChangesRecord): ConflictCause {
  if (record.kind === "folder") return "work"
  const at = new Set(record.startConflicts)
  return record.conflicts.length > 0 && record.conflicts.every(f => at.has(f))
    ? "start"
    : "work"
}

/**
 * The proposed changes' state and buttons. `asked` is when the agent last asked
 * about a conflict on the thread's path (`conflictAskTime`); it asks for you
 * only when newer than the proposed changes. `base` is the lane's
 * (`pinetrie.base`), null before the host read it, as accepted work; `into` and
 * `unfinishedAhead` come from accepted work's record. Jj proposed changes' acceptance
 * is offered only with a destination (`acceptanceDestinations`); a folder
 * project's one is accepted work, the project's folder, for clean proposed
 * changes.
 */
export function workStripView(input: {
  readonly proposed: ProposedChangesStatus
  readonly activity: Exclude<WorkStripActivity, "get-latest">
  readonly asked: number | null
  readonly base: FollowedBase | null
  /** Null for a jj project whose accepted work is not read yet: nothing to accept into. */
  readonly into: AcceptsInto | null
  readonly unfinishedAhead: number
  /** What catching up would do (`latestNow`). */
  readonly getLatest: LatestNow
  /** Accepted thread commits of this thread that name no source (`BaseRecord.untraced`). */
  readonly untraced: boolean
  /**
   * The commands of the cards queued on its lane: a catch-up makes the proposed
   * changes busy; a split quiets the split button.
   */
  readonly queued: readonly CardCommand[]
  /** The thread this one branched from (`parentNow`); null for one that began at its base. */
  readonly parent: ParentNow | null
  /** That thread's agent runs: its copy moves with every turn. */
  readonly parentRunning: boolean
}): WorkStripView {
  const { proposed, asked } = input
  const activity: WorkStripActivity =
    input.activity === "idle" && input.queued.some(isGetLatest)
      ? "get-latest"
      : input.activity
  const notYetAccepted =
    proposed.kind === "open" || proposed.kind === "held"
      ? proposed.record
      : undefined
  const open = proposed.kind === "open" ? proposed.record : undefined
  const jjOpen = open?.kind === "jj" ? open : undefined
  const jjBase = input.base?.kind === "jj" ? input.base : null
  const ahead =
    input.parent !== null && parentAhead(input.parent) ? input.parent : null
  const cause: ConflictCause = open === undefined ? "work" : conflictCause(open)
  const parentResolves =
    ahead !== null &&
    open?.conflicts.every(f => !ahead.conflicts.includes(f)) === true
  const facts: WorkStripFacts = {
    activity,
    files: open?.files.length ?? 0,
    // Folder proposed changes are one change: never a stack.
    size: open === undefined ? 0 : (jjOpen?.size ?? 1),
    conflicts: open?.conflicts.length ?? 0,
    touchesWorkingCopyEdits: (jjOpen?.workingCopyEdits.length ?? 0) > 0,
    bookmark: notYetAccepted?.kind === "jj" ? notYetAccepted.bookmark : null,
    held: proposed.kind === "held",
    acceptedAs: proposed.kind === "accepted" ? proposed.as : null,
    base: effectiveBase(input.base),
    into: input.into,
    getLatest: input.getLatest,
    untraced: input.untraced,
    conflictCause: cause,
    parent: ahead,
    parentResolves,
  }
  const { into } = input
  const destinations =
    open === undefined || into === null
      ? []
      : acceptanceDestinations({
          base: jjBase?.base ?? { kind: "accepted" },
          state: jjBase?.state ?? "ok",
          // A folder has no bookmark: the wire's empty destination is the default.
          acceptedBookmark: into.kind === "bookmark" ? into.bookmark : "",
          conflicted: open.conflicts.length > 0,
          unfinishedAhead: input.unfinishedAhead,
        })
  const gone = jjBase?.state === "gone"
  const integrable = (
    buttons: readonly WorkStripButton[],
  ): readonly WorkStripButton[] =>
    destinations.length === 0 ? buttons.filter(b => b !== "accept") : buttons
  const view = (
    state: WorkStripView["state"],
    buttons: readonly WorkStripButton[],
    listed: readonly WorkStripButton[],
  ): WorkStripView => {
    // A thread whose WIP is gone is brought up to date only by moving it to
    // accepted work.
    const toAccepted = (bs: readonly WorkStripButton[]) =>
      gone ? bs.map(b => (b === "update" ? "continue" : b)) : bs
    // While the parent is ahead, catching up with it is listed, unless it
    // already stands beside the proposed changes.
    const menu = [
      ...toAccepted(listed),
      ...(ahead !== null && !buttons.includes("get-latest-from-parent")
        ? (["get-latest-from-parent"] as const)
        : []),
    ]
    // When it brings work, or must come before any proposed changes, catching
    // up stands beside the proposed changes; when it would change nothing, it
    // is quiet.
    const { kind } = input.getLatest
    const shown =
      (kind === "brings" || input.untraced) && menu.includes("update")
        ? {
            buttons: [...buttons, "update" as const],
            menu: menu.filter(b => b !== "update"),
          }
        : { buttons, menu }
    const quiet: WorkStripButton[] = [
      ...(!input.untraced && (kind === "current" || kind === "nothing-new")
        ? (["update"] as const).filter(b => shown.menu.includes(b))
        : []),
      // The parent's copy moves with every turn: not while it runs.
      ...(ahead !== null && input.parentRunning
        ? (["get-latest-from-parent"] as const)
        : []),
      // A split already waits in the queue.
      ...(input.queued.includes("split") ? (["split"] as const) : []),
    ]
    // An untraced start rebuilds nothing: only your edited proposed changes are
    // left.
    const rebuilds = (b: WorkStripButton) =>
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
  if (proposed.kind === "none") return view("nothing", [], ["update"])
  if (proposed.kind === "accepted") return view("accepted", [], ["update"])
  const { record } = proposed
  if (asked !== null && asked > record.at)
    return view("needs_you", ["accept"], ["update"])
  if (proposed.kind === "held") return view("nothing", [], ["update"])
  if (record.kind === "jj" && record.edited)
    return view("edited", ["accept", "refresh"], ["update"])
  // A conflict that came with the lane's copy, which the parent has since
  // resolved, is settled by catching up with the parent; any other by
  // catching up with the base and resolving.
  if (record.conflicts.length > 0)
    return view(
      "conflicts",
      record.kind === "folder"
        ? ["choose-versions", "update", "accept"]
        : cause === "start" && parentResolves
          ? ["get-latest-from-parent", "accept"]
          : ["update", "accept"],
      [],
    )
  // Folder proposed changes are its files: never split, never a stack.
  if (record.kind === "folder")
    return view("ready", ["accept"], ["describe", "update"])
  if (record.size > 1)
    return record.stale
      ? view("stale", ["split", "accept"], ["update"])
      : view("stack", ["accept", "squash"], ["update"])
  return view("ready", ["accept", "split"], ["describe", "update"])
}
