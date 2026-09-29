// offer — a lane's work, as one revision or a stack in your repo (ADR-0038,
// ADR-0039).
//
// Every decision an offer needs, pure, over what the host gathers from jj and
// the document: what a trigger does to it (`planRefresh`), its state and
// what can be done in it (`offerView`), whether the agent's stack may replace it
// (`acceptStack`), and the commit-message request (`describeRequest`,
// `withTrailers`, `wipDescription`). The jj steps that carry them out, and
// where an offer starts (`offerStart`), are planned in `@pineta/lanes`.

import {
  type CommitId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type OfferRecord,
  type ThreadName,
} from "@pineta/core"

/** What the host found of one revision of an offer, against what it wrote. */
export interface RevisionFacts {
  /** The description is the one the host last wrote. */
  readonly sameDescription: boolean
  /** `jj interdiff` against the commit the host last wrote is empty. */
  readonly sameChange: boolean
}

/** What a trigger found: the lane, your repo, and the offer if there is one. */
export interface RefreshFacts {
  /** The lane's tip in your repo; null before its first fetch. */
  readonly tip: CommitId | null
  /** Where an offer would start, and whether that is the tip: nothing new. */
  readonly start: readonly CommitId[]
  readonly offer:
    | (Pick<OfferRecord, "size" | "taken"> & {
        readonly builtFrom: CommitId
        /** Where it started when built or last followed. */
        readonly builtOn: readonly CommitId[]
        readonly revisions: readonly RevisionFacts[]
        /** Its bottom's parent is an ancestor of the target (S48 item 7). */
        readonly placed: boolean
        /** Its bottom's parent is the target itself. */
        readonly onTarget: boolean
        /** Two visible commits share one of its change ids (S48 item 8). */
        readonly divergent: boolean
      })
    | undefined
}

/**
 * What a trigger does to a lane's offer:
 * - `none`: nothing to do;
 * - `build`: make an offer (there is none, or the last was taken);
 * - `follow`: the lane, or where the offer starts, moved under an unedited
 *   single offer: update it in place (ADR-0039, S49);
 * - `withdraw`: where it starts reached the lane's tip, so it holds nothing
 *   you lack: abandon it (S49 item 5);
 * - `stale`: the lane, or where it starts, moved under a stack: kept, marked
 *   stale;
 * - `refresh`: only the target moved: rebase the offer onto it;
 * - `leave`: you edited it; the host never touches it again;
 * - `repair`: a race left it divergent; keep yours, abandon the host's.
 */
export type RefreshPlan =
  | "none"
  | "build"
  | "follow"
  | "withdraw"
  | "stale"
  | "refresh"
  | "leave"
  | "repair"

export function planRefresh(facts: RefreshFacts): RefreshPlan {
  const { tip, offer } = facts
  if (tip === null) return "none"
  const nothingNew = facts.start.length === 1 && facts.start[0] === tip
  if (offer === undefined || offer.taken !== null)
    return nothingNew ? "none" : "build"
  if (offer.divergent) return "repair"
  const edited =
    !offer.placed ||
    offer.revisions.some(r => !r.sameDescription || !r.sameChange)
  if (edited) return "leave"
  const moved =
    offer.builtFrom !== tip || !sameCommits(offer.builtOn, facts.start)
  if (moved) {
    if (offer.size > 1) return "stale"
    return nothingNew ? "withdraw" : "follow"
  }
  return offer.onTarget ? "none" : "refresh"
}

/** Two starts name the same commits: a merge's parents in any order. */
const sameCommits = (a: readonly CommitId[], b: readonly CommitId[]): boolean =>
  a.length === b.length && a.every(c => b.includes(c))

/** What a stack's check found: how many files differ from the lane's tip. */
export function acceptStack(input: {
  readonly revisions: number
  readonly differing: readonly string[]
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (input.revisions < 1)
    return { ok: false, reason: "the stack has no revisions" }
  if (input.differing.length > 0)
    return {
      ok: false,
      reason: `the stack's last revision differs from this thread's files: ${input.differing.join(", ")}`,
    }
  return { ok: true }
}

// ── its state and buttons ─────────────────────────────────────────────────

/** A button beside the offer, or in its menu. */
export type OfferButton =
  | "take"
  | "split"
  | "squash"
  | "describe"
  | "refresh"
  | "resolve"
  | "update"

/** What the lane is running now, as far as the offer cares. */
export type OfferActivity = "idle" | "turn" | "resolution" | "split"

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
    | "taken"
  /** Buttons beside the offer, the first the primary one. */
  readonly buttons: readonly OfferButton[]
  /** Buttons in the offer's menu. */
  readonly menu: readonly OfferButton[]
  readonly facts: OfferFacts
}

/** What an offer's words are made from. */
export interface OfferFacts {
  readonly activity: OfferActivity
  /** Files in the untaken offer; 0 with none. */
  readonly files: number
  /** Revisions in the untaken offer: more than one is a stack. */
  readonly size: number
  /** Files that conflict with your work. */
  readonly conflicts: number
  /** It touches files you have uncommitted edits in. */
  readonly touchesYourEdits: boolean
  /** Its bookmark, to find it in jj; null with no untaken offer. */
  readonly bookmark: string | null
  /** The change id it was taken as, or null. */
  readonly taken: string | null
}

/**
 * The offer's state and buttons. `landing` is the lane's latest resolution;
 * it asks for you only when newer than the offer.
 */
export function offerView(input: {
  readonly offer: OfferRecord | undefined
  readonly activity: OfferActivity
  readonly landing: LandingRecord | undefined
}): OfferView {
  const { offer, activity, landing } = input
  const open = offer?.taken === null ? offer : undefined
  const facts: OfferFacts = {
    activity,
    files: open?.files.length ?? 0,
    size: open?.size ?? 0,
    conflicts: open?.conflicts.length ?? 0,
    touchesYourEdits: (open?.yourEdits.length ?? 0) > 0,
    bookmark: open?.bookmark ?? null,
    taken: offer?.taken ?? null,
  }
  const view = (
    state: OfferView["state"],
    buttons: readonly OfferButton[],
    menu: readonly OfferButton[],
  ): OfferView => ({ state, buttons, menu, facts })
  if (activity === "turn") return view("running", [], [])
  if (activity !== "idle") return view("busy", [], [])
  if (offer === undefined) return view("nothing", [], ["update"])
  if (offer.taken !== null) return view("taken", [], ["update"])
  if (landing?.state === "needs_you" && landing.at > offer.at)
    return view("needs_you", ["take"], ["update"])
  if (offer.edited) return view("edited", ["take", "refresh"], ["update"])
  if (offer.conflicts.length > 0)
    return view("conflicts", ["resolve", "take"], [])
  if (offer.size > 1)
    return offer.stale
      ? view("stale", ["split", "take"], ["update"])
      : view("stack", ["take", "squash"], ["update"])
  return view("ready", ["take", "split"], ["describe", "update"])
}

// ── the commit message ────────────────────────────────────────────────────

const THREAD_TRAILER = "Pineta-Thread"
const LANE_TRAILER = "Pineta-Lane"
const ENTRY_TRAILER = "Pineta-Entry"
/** Room for "- (N earlier left out)". */
const LEFT_OUT_NOTE = 32

/**
 * The one line an offer carries until an agent describes it: a work in
 * progress, named by its thread and the thread's own first message
 * (ADR-0039).
 */
export const wipDescription = (name: ThreadName, first: string): string =>
  `WIP (${name}): ${firstLine(first, 60) || "this thread's work"}`

/** A message with the host's own trailers: the thread, the lane and the newest entry. */
export const withTrailers = (
  message: string,
  at: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
  },
): string =>
  `${message.trim()}\n\n${THREAD_TRAILER}: ${at.name}\n${LANE_TRAILER}: ${at.lane}\n${ENTRY_TRAILER}: ${at.entry}\n`

/**
 * The commit-message request: the skill as the system text, then your repo's
 * recent descriptions, what the thread said since the last take, and the
 * diff. Over `budget` characters, the thread's messages go first, oldest
 * first, then the diff is cut; the skill never is.
 */
export function describeRequest(input: {
  readonly skill: string
  readonly diff: string
  readonly messages: readonly string[]
  readonly recent: readonly string[]
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const recent = input.recent.map(r => `- ${firstLine(r, 120)}`).join("\n")
  const head = `Recent commit messages in this repository:\n${recent || "- (none)"}\n\n`
  let room = Math.max(0, input.budget - head.length)
  // The diff is kept whole when it fits; the messages share what is left,
  // less room for the line saying how many were left out.
  let messageRoom = Math.max(
    0,
    room - Math.min(input.diff.length, room) - LEFT_OUT_NOTE,
  )
  const kept: string[] = []
  for (const m of input.messages.toReversed()) {
    const line = `- ${m.trim()}\n`
    if (line.length > messageRoom) break
    kept.unshift(line)
    messageRoom -= line.length
  }
  const dropped = input.messages.length - kept.length
  const said =
    (dropped > 0 ? `- (${dropped} earlier left out)\n` : "") +
    (kept.join("") || "- (no messages)\n")
  room -= said.length
  const diff =
    input.diff.length <= room
      ? input.diff
      : `${input.diff.slice(0, Math.max(0, room - 40))}\n… (the rest of the diff left out)`
  return {
    system: input.skill.trim(),
    user: `${head}What the thread said:\n${said}\nThe change:\n${diff}`,
  }
}
