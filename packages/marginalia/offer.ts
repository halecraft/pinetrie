// offer — a lane's work, as one revision or a stack in your repo (ADR-0038).
//
// Every decision an offer needs, pure, over what the host gathers from jj and
// the document: what a trigger does to it (`planRefresh`), what the column shows and offers (`offerView`), whether
// the agent's stack may replace it (`acceptStack`), and the commit-message
// request (`describeRequest`, `withTrailers`, `placeholderDescription`). The
// jj steps that carry them out, and where an offer starts (`offerStart`),
// are planned in `@pineta/lanes`.

import {
  type CommitId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type OfferRecord,
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
 * - `rebuild`: the lane moved on under an unedited single offer;
 * - `stale`: the lane moved on under a stack: kept, marked stale;
 * - `refresh`: only the target moved: rebase the offer onto it;
 * - `leave`: you edited it; the host never touches it again;
 * - `repair`: a race left it divergent; keep yours, abandon the host's.
 */
export type RefreshPlan =
  | "none"
  | "build"
  | "rebuild"
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
  if (offer.builtFrom !== tip) return offer.size > 1 ? "stale" : "rebuild"
  return offer.onTarget ? "none" : "refresh"
}

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

// ── what the column shows ─────────────────────────────────────────────────

/** A button on the offer's line, or in the column's menu. */
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

/** One state of a lane's offer, and what can be done in it (ADR-0038's table). */
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
  /** The line the column shows; empty when it shows none. */
  readonly line: string
  /** Buttons on the line, the first the primary one. */
  readonly buttons: readonly OfferButton[]
  /** Buttons in the column's menu. */
  readonly menu: readonly OfferButton[]
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

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
  if (activity === "turn")
    return {
      state: "running",
      line: "offer updates after each turn",
      buttons: [],
      menu: [],
    }
  if (activity !== "idle")
    return {
      state: "busy",
      line:
        activity === "resolution"
          ? "resolving your work into this thread"
          : "splitting the offer into a stack",
      buttons: [],
      menu: [],
    }
  if (offer === undefined)
    return { state: "nothing", line: "", buttons: [], menu: ["update"] }
  if (offer.taken !== null)
    return {
      state: "taken",
      line: `taken as ${offer.taken.slice(0, 8)}`,
      buttons: [],
      menu: ["update"],
    }
  if (landing?.state === "needs_you" && landing.at > offer.at)
    return {
      state: "needs_you",
      line: "the agent asked you about your work: see the thread",
      buttons: ["take"],
      menu: ["update"],
    }
  const files = count(offer.files.length, "file", "files")
  const where = `\`${offer.bookmark}\``
  if (offer.edited)
    return {
      state: "edited",
      line: `you edited this offer · ${where}`,
      buttons: ["take", "refresh"],
      menu: ["update"],
    }
  if (offer.conflicts.length > 0)
    return {
      state: "conflicts",
      line: `conflicts with your work in ${count(offer.conflicts.length, "file", "files")}`,
      buttons: ["resolve", "take"],
      menu: [],
    }
  const yours =
    offer.yourEdits.length === 0 ? "" : " · conflicts expected in your edits"
  if (offer.size > 1)
    return offer.stale
      ? {
          state: "stale",
          line: `a stack of ${offer.size}, and changes since · ${where}`,
          buttons: ["split", "take"],
          menu: ["update"],
        }
      : {
          state: "stack",
          line: `offer: a stack of ${offer.size} · ${files} · ${where}${yours}`,
          buttons: ["take", "squash"],
          menu: ["update"],
        }
  return {
    state: "ready",
    line: `offer: ${files} · ${where}${yours}`,
    buttons: ["take", "split"],
    menu: ["describe", "update"],
  }
}

// ── the commit message ────────────────────────────────────────────────────

const LANE_TRAILER = "Pineta-Lane"
/** Room for "- (N earlier left out)". */
const LEFT_OUT_NOTE = 32
const ENTRY_TRAILER = "Pineta-Entry"

/** The one line an offer carries until an agent describes it. */
export const placeholderDescription = (thread: string): string =>
  `offer: ${firstLine(thread, 60) || "this thread's work"}`

/** A message with the host's own trailers: the lane and the newest entry. */
export const withTrailers = (
  message: string,
  lane: LaneName,
  entry: string,
): string =>
  `${message.trim()}\n\n${LANE_TRAILER}: ${lane}\n${ENTRY_TRAILER}: ${entry}\n`

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
