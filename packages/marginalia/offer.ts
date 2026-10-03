// offer — a lane's work, as one revision or a stack in your repo (ADR-0038,
// ADR-0039).
//
// Every decision an offer needs, pure, over what the host gathers from jj and
// the document: what a trigger does to it (`planRefresh`), its state and
// what can be done in it (`offerView`), whether the agent's stack may replace it
// (`acceptStack`), the commit-message request (`describeRequest`,
// `withTrailers`, `wipDescription`), and the review's wire: its URLs, what a
// request may read and how it is answered (`planOfferRead`, `answerReview`,
// `answerDiff`). The jj steps that carry them out, and where an offer starts
// (`startOfOffer`), are in `@pineta/repo`.

import {
  type BaseRecord,
  type CommitId,
  type DiffSpan,
  type EntryId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type LineRecord,
  type OfferInRepo,
  type OfferLedger,
  type OfferRecord,
  type OfferSeen,
  type RevisionFacts,
  type RevisionRecord,
  type RevisionReview,
  spanKey,
  type ThreadBase,
  type ThreadName,
  TRAILERS,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { fitNewest, LEFT_OUT_NOTE, leftOut } from "./request.ts"

/**
 * Whether you edited a revision: a version an operation not the host's made
 * changed it since the host's newest version (S73). A revision the host
 * never made is yours. A rebase jj made because you reworded a commit below
 * is your operation but changes nothing (S48 item 7), so it is no edit.
 */
export const revisionEdited = (r: RevisionFacts): boolean =>
  !r.reached || r.yoursChanged

/** An offer read from your repo, not divergent. */
export type OfferNow = Extract<OfferInRepo, { readonly kind: "offer" }>

/**
 * Whether you edited the offer: a revision edited, a commit of yours between
 * its revisions, or its bottom moved off its base (S48 item 7). The host
 * never touches it again; nothing it writes later can hide your version.
 */
export const offerEdited = (offer: OfferNow): boolean =>
  !offer.placed ||
  !offer.chained ||
  offer.revisions.some(r => revisionEdited(r.since))

/**
 * Whether the lane, or where the offer starts, moved since it was built or
 * last followed: its ledger against the lane's tip and start now. An offer
 * with no ledger, built before ADR-0060, reads as moved, so it is followed
 * once, which writes one. A start is compared as a set: a merge's parents
 * come in any order.
 */
export const offerMoved = (
  ledger: OfferLedger | null,
  now: { readonly tip: CommitId; readonly start: readonly CommitId[] },
): boolean =>
  ledger === null ||
  ledger.source !== now.tip ||
  !sameCommits(ledger.start, now.start)

/**
 * What a trigger found: the offer as your repo holds it (null when there is
 * none: never built, taken, or gone), and, for a thread not archived, its
 * lane.
 */
export type RefreshFacts =
  /** The thread's root is archived (ADR-0029). */
  | { readonly archived: true; readonly offer: OfferInRepo | null }
  | {
      readonly archived: false
      /** The lane's tip in your repo. */
      readonly tip: CommitId
      /** Where an offer would start; the tip itself when nothing is new. */
      readonly start: readonly CommitId[]
      /** The lane's work since its start changes no file. */
      readonly empty: boolean
      readonly offer: OfferInRepo | null
    }

/**
 * What a trigger does to a lane's offer:
 * - `none`: nothing to do;
 * - `build`: make an offer (there is none: never built, taken, or gone);
 * - `follow`: the lane, or where the offer starts, moved under an unedited
 *   single offer: update it in place (ADR-0039, S49);
 * - `withdraw`: it holds nothing you lack (where it starts reached the
 *   lane's tip, or the lane's work changes no file), or its thread is
 *   archived: abandon it (S49 item 5);
 * - `forget`: there is no offer and none to build: remove a record left
 *   from one;
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
  | "forget"
  | "stale"
  | "refresh"
  | "leave"
  | "repair"

/**
 * An archived thread's offer goes whatever its state, an edited one too:
 * an offer is immutable, so editing one is an expert's own act. A lane whose
 * work changes no file is never built: withdrawing what was built would
 * repeat on every poll, since each step moves your repo's operation head.
 */
export function planRefresh(facts: RefreshFacts): RefreshPlan {
  const { offer } = facts
  if (facts.archived) return offer === null ? "forget" : "withdraw"
  const { tip, start } = facts
  const nothingNew = facts.empty || (start.length === 1 && start[0] === tip)
  if (offer === null) return nothingNew ? "forget" : "build"
  if (offer.kind === "divergent") return "repair"
  if (offerEdited(offer)) return "leave"
  if (facts.empty) return "withdraw"
  if (offerMoved(offer.ledger, { tip, start })) {
    if (offer.revisions.length > 1) return "stale"
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

/**
 * Where a take may move a bookmark to the offer (ADR-0060): a forward move,
 * never a rebase, so every destination gives the same tree.
 */
export interface TakeDestination {
  readonly bookmark: string
  readonly kind: "line" | "wip"
  /** Commits of yours that land with the offer: the WIP's, onto the line. */
  readonly bringsAlong: number
  /** What moves is immutable after: the line. */
  readonly final: boolean
}

/**
 * The bookmarks a take may move to the offer, the default first (ADR-0060):
 * the one the lane is based on, and, for a WIP, the line too, landing the
 * WIP's commits with it. Only a clean offer lands on the line: the line is
 * immutable, and a conflict taken onto it would stay in its history. A WIP
 * gone without landing has none; one that landed is the line's. Pure.
 */
export function takeDestinations(input: {
  readonly base: ThreadBase
  readonly state: "ok" | "landed" | "gone"
  readonly onto: string
  readonly conflicted: boolean
  /** The WIP's commits above the line, for a WIP base. */
  readonly wipAhead: number
}): readonly TakeDestination[] {
  const line = (bringsAlong: number): TakeDestination[] =>
    input.conflicted
      ? []
      : [{ bookmark: input.onto, kind: "line", bringsAlong, final: true }]
  if (input.state === "gone") return []
  if (input.base.kind === "line" || input.state === "landed") return line(0)
  return [
    {
      bookmark: input.base.bookmark,
      kind: "wip",
      bringsAlong: 0,
      final: false,
    },
    ...line(input.wipAhead),
  ]
}

/**
 * A button beside the offer, or in its menu. `take` takes it to its default
 * destination; `take-line` onto the line, from a WIP thread; `continue`
 * moves a thread whose WIP is gone to the line (ADR-0060).
 */
export type OfferButton =
  | "take"
  | "take-line"
  | "continue"
  | "split"
  | "squash"
  | "describe"
  | "refresh"
  | "resolve"
  | "update"

/**
 * What the lane is running now, as far as the offer cares; `catch-up`: a
 * card that brings it up to date is queued, and taken before anything else.
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
    | "taken"
  /** Buttons beside the offer, the first the primary one. */
  readonly buttons: readonly OfferButton[]
  /** Buttons in the offer's menu. */
  readonly menu: readonly OfferButton[]
  /** Where `take` (the first) and `take-line` (the line, from a WIP) go. */
  readonly destinations: readonly TakeDestination[]
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
  /**
   * The thread's base, as it is brought up to date and taken (ADR-0060): its
   * WIP, or the line once the WIP landed or for a line thread.
   */
  readonly base: ThreadBase
  /** The line's bookmark, for titles. */
  readonly onto: string
  /** The thread's base has moved on since the lane last forked or caught up. */
  readonly behind: boolean
}

/**
 * The base a thread is brought up to date with and taken to (ADR-0060): its
 * WIP while the WIP is there, else the line: for a line thread, a WIP that
 * landed, and one gone (which only "continue on the line" moves). Null, the
 * lane's base not yet read, is the line.
 */
export const effectiveBase = (
  base: Pick<BaseRecord, "base" | "state"> | null,
): ThreadBase =>
  base?.base.kind === "wip" && base.state === "ok"
    ? base.base
    : { kind: "line" }

/** Where a thread's base moved since its lane last took from it (`baseMoved`). */
export interface BaseMove {
  readonly base: ThreadBase
  /** The base's bookmark: the line's, or the WIP's. */
  readonly bookmark: string
  /** The commit the lane's newest `Pineta-Base` names, and the base's now. */
  readonly from: CommitId
  readonly to: CommitId
}

/**
 * How a thread's base has moved on since its lane last forked from it or
 * caught up (ADR-0060), or null: the commit its newest `Pineta-Base` names
 * (`start`) against where the base is now, the line's commit or the WIP's.
 * Never for a WIP gone, which only "continue on the line" moves, nor before
 * the line is set up.
 */
export function baseMoved(
  base: BaseRecord | undefined,
  line: LineRecord | null,
): BaseMove | null {
  if (base === undefined || line === null || line.commit === null) return null
  if (base.state === "gone") return null
  const thread = effectiveBase(base)
  const now =
    thread.kind === "line"
      ? { bookmark: line.onto, commit: line.commit }
      : line.wips.find(w => w.bookmark === thread.bookmark)
  return now === undefined || now.commit === base.start
    ? null
    : { base: thread, bookmark: now.bookmark, from: base.start, to: now.commit }
}

/**
 * The offer's state and buttons. `landing` is the lane's latest resolution;
 * it asks for you only when newer than the offer. `base` is the lane's
 * (`pineta.base`), null before the host read it, as the line; `onto` and
 * `wipAhead` come from the line's record. A take is offered only with a
 * destination (`takeDestinations`).
 */
export function offerView(input: {
  readonly offer: OfferRecord | undefined
  readonly activity: Exclude<OfferActivity, "catch-up">
  readonly landing: LandingRecord | undefined
  readonly base: Pick<BaseRecord, "base" | "state"> | null
  readonly onto: string
  readonly wipAhead: number
  /** `baseMoved`: the base has moved on, so catching up is offered beside it. */
  readonly behind: boolean
  /** A card bringing the thread up to date is queued on its lane. */
  readonly catchingUp: boolean
}): OfferView {
  const { offer, landing } = input
  const activity: OfferActivity =
    input.activity === "idle" && input.catchingUp ? "catch-up" : input.activity
  const open = offer?.taken === null ? offer : undefined
  const facts: OfferFacts = {
    activity,
    files: open?.files.length ?? 0,
    size: open?.size ?? 0,
    conflicts: open?.conflicts.length ?? 0,
    touchesYourEdits: (open?.yourEdits.length ?? 0) > 0,
    bookmark: open?.bookmark ?? null,
    taken: offer?.taken ?? null,
    base: effectiveBase(input.base),
    onto: input.onto,
    behind: input.behind,
  }
  const destinations =
    open === undefined
      ? []
      : takeDestinations({
          base: input.base?.base ?? { kind: "line" },
          state: input.base?.state ?? "ok",
          onto: input.onto,
          conflicted: open.conflicts.length > 0,
          wipAhead: input.wipAhead,
        })
  const gone = input.base?.state === "gone"
  const takes = (buttons: readonly OfferButton[]): readonly OfferButton[] =>
    destinations.length === 0 ? buttons.filter(b => b !== "take") : buttons
  const view = (
    state: OfferView["state"],
    buttons: readonly OfferButton[],
    listed: readonly OfferButton[],
  ): OfferView => {
    // A thread whose WIP is gone is brought up to date only by moving it to
    // the line.
    const menu = gone
      ? listed.map(b => (b === "update" ? "continue" : b))
      : listed
    // Behind its base, catching up stands beside the offer.
    const shown =
      input.behind && menu.includes("update")
        ? {
            buttons: [...buttons, "update" as const],
            menu: menu.filter(b => b !== "update"),
          }
        : { buttons, menu }
    return {
      state,
      buttons: takes(shown.buttons),
      menu: [
        ...shown.menu,
        ...(destinations.length > 1 ? (["take-line"] as const) : []),
      ],
      destinations,
      facts,
    }
  }
  if (activity === "turn") return view("running", [], [])
  if (activity !== "idle") return view("busy", [], [])
  if (offer === undefined) return view("nothing", [], ["update"])
  if (offer.taken !== null) return view("taken", [], ["update"])
  if (landing?.state === "needs_you" && landing.at > offer.at)
    return view("needs_you", ["take"], ["update"])
  if (offer.edited) return view("edited", ["take", "refresh"], ["update"])
  // The lane's work is already where the offer sits, by a route the ledger
  // does not record (a squash that dropped its trailers): nothing to take.
  if (offer.files.length === 0) return view("nothing", [], ["update"])
  if (offer.conflicts.length > 0)
    return view("conflicts", ["resolve", "take"], [])
  if (offer.size > 1)
    return offer.stale
      ? view("stale", ["split", "take"], ["update"])
      : view("stack", ["take", "squash"], ["update"])
  return view("ready", ["take", "split"], ["describe", "update"])
}

// ── the commit message ────────────────────────────────────────────────────

/**
 * The one line an offer carries until an agent describes it: a work in
 * progress, named by its thread and the thread's own first message
 * (ADR-0039).
 */
export const wipDescription = (name: ThreadName, first: string): string =>
  `WIP (${name}): ${firstLine(first, 60) || "this thread's work"}`

/**
 * Whether an offer is one to ask a commit message for: a single revision,
 * not yours, and still on its WIP line unless `force` asks again.
 */
export const describeWanted = (
  offer: OfferInRepo | null,
  name: ThreadName,
  force: boolean,
): offer is OfferNow =>
  offer?.kind === "offer" &&
  offer.revisions.length === 1 &&
  !offerEdited(offer) &&
  (force || isWipLine(name, offer.firstLine))

/** Whether a first line is still the WIP line (`wipDescription`): no agent described it. */
export const isWipLine = (name: ThreadName, line: string): boolean =>
  line.startsWith(`WIP (${name}): `)

/** A message with the host's own trailers: the thread, the lane and the newest entry. */
export const withTrailers = (
  message: string,
  at: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
  },
): string =>
  `${message.trim()}\n\n${TRAILERS.thread}: ${at.name}\n${TRAILERS.lane}: ${at.lane}\n${TRAILERS.entry}: ${at.entry}\n`

/**
 * A message with the offer's ledger (ADR-0060): the lane commit it holds
 * (`Pineta-Source`) and where it starts (`Pineta-Start`, one per commit).
 * Added to the host's trailer paragraph when the message ends in one, else
 * as a paragraph of its own. Taken, the offer keeps them: they say what you
 * have of the lane, wherever its commit goes.
 */
export function withLedger(
  message: string,
  ledger: {
    readonly source: CommitId
    readonly start: readonly CommitId[]
  },
): string {
  const lines = [
    `${TRAILERS.source}: ${ledger.source}`,
    ...ledger.start.map(c => `${TRAILERS.start}: ${c}`),
  ].join("\n")
  const text = message.trimEnd()
  const ours = Object.values(TRAILERS).map(t => `${t}: `)
  const last = text.slice(text.lastIndexOf("\n\n") + 2).split("\n")
  const endsInOurs =
    text.includes("\n\n") &&
    last.every(line => ours.some(t => line.startsWith(t)))
  return `${text}${endsInOurs ? "\n" : "\n\n"}${lines}\n`
}

/**
 * A message for one revision of an offer: `message` with the host's
 * trailers, then the offer's ledger, in one trailer paragraph. Every revision
 * carries both: the thread's trailer is how the host finds the offer's
 * revisions in your repo, and the ledger names the lane tip the whole offer
 * holds, so a taken stack says you have that tip (ADR-0060).
 */
export const offerMessage = (
  message: string,
  at: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
    readonly ledger: OfferLedger
  },
): string => withLedger(withTrailers(message, at), at.ledger)

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
  const { text, dropped } = fitNewest(
    input.messages,
    Math.max(0, room - Math.min(input.diff.length, room) - LEFT_OUT_NOTE),
  )
  const said = leftOut(dropped) + (text || "- (no messages)\n")
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

// ── the review (ADR-0047) ─────────────────────────────────────────────────

/**
 * The host's trailers removed: a last paragraph made only of `TRAILERS`
 * lines, and the blank line before it. A paragraph holding any other line,
 * your own trailers included, stays whole.
 */
export function withoutTrailers(message: string): string {
  const text = message.trimEnd()
  const cut = text.lastIndexOf("\n\n")
  const last = text.slice(cut + 2).split("\n")
  const ours = Object.values(TRAILERS).map(t => `${t}: `)
  const onlyOurs =
    cut >= 0 && last.every(line => ours.some(t => line.startsWith(t)))
  return onlyOurs ? text.slice(0, cut).trim() : text.trim()
}

const ReviewFileSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  shown: Type.String({ minLength: 1 }),
  change: Type.Union([
    Type.Literal("added"),
    Type.Literal("modified"),
    Type.Literal("removed"),
    Type.Literal("copied"),
    Type.Literal("renamed"),
  ]),
  added: Type.Integer({ minimum: 0 }),
  removed: Type.Integer({ minimum: 0 }),
})

const RevisionReviewSchema = Type.Object({
  description: Type.String(),
  files: Type.Array(ReviewFileSchema),
})

/**
 * A revision's review from the wire: jj's output on the host, the host's
 * answer in the page. A change to it bumps `OFFER_WIRE`.
 */
export const decodeRevisionReview = (
  value: unknown,
): RevisionReview | undefined => decodeWith(RevisionReviewSchema, value, r => r)

/**
 * The version of what `/offer/` answers: `REVISION_READ` (`@pineta/lanes`)
 * and the range read (`@pineta/repo`), `decodeRevisionReview`, `fileDiff`'s
 * flags, and the URLs' spans. Every answer is cached as immutable under a URL holding it,
 * so a change to any of them bumps it, or pages keep the old shape.
 */
export const OFFER_WIRE = 2

/**
 * What a page asks: a span's review, or one file's diff in it. The commits
 * are the request's strings until `planOfferRead` finds them in a record.
 */
export type OfferAsk =
  | { readonly kind: "review"; readonly span: AskedSpan }
  | {
      readonly kind: "diff"
      readonly span: AskedSpan
      readonly path: string
    }

/** A span as a request names it (`DiffSpan`), its commits unchecked. */
export type AskedSpan =
  | { readonly kind: "revision"; readonly commit: string }
  | { readonly kind: "range"; readonly from: string; readonly to: string }

const OFFER_PREFIX = "/offer/"

/**
 * A span's review: `/offer/<OFFER_WIRE>/review/<commit>` for a revision,
 * `…/review/<from>..<to>` for a range (`spanKey`).
 */
export const reviewUrl = (span: DiffSpan): string =>
  `${OFFER_PREFIX}${OFFER_WIRE}/review/${spanKey(span)}`

/** One file's diff in a span: `/offer/<OFFER_WIRE>/diff/<span>?path=…`. */
export const diffUrl = (span: DiffSpan, path: string): string =>
  `${OFFER_PREFIX}${OFFER_WIRE}/diff/${spanKey(span)}?${new URLSearchParams({ path })}`

const HEX = /^[0-9a-f]+$/

/** `spanKey`'s string back as a span, or null. */
function parseSpan(text: string | undefined): AskedSpan | null {
  if (text === undefined) return null
  const [from, to, ...more] = text.split("..")
  if (from === undefined || !HEX.test(from) || more.length > 0) return null
  if (to === undefined) return { kind: "revision", commit: from }
  return HEX.test(to) ? { kind: "range", from, to } : null
}

/**
 * An `/offer/` path as an ask: `bad` for anything else under `/offer/`,
 * another version included, so the host answers only the wire it speaks;
 * null for a path outside it.
 */
export function parseOfferPath(url: URL): OfferAsk | "bad" | null {
  if (url.pathname !== "/offer" && !url.pathname.startsWith(OFFER_PREFIX))
    return null
  const [version, kind, named, ...rest] = url.pathname
    .slice(OFFER_PREFIX.length)
    .split("/")
  if (version !== String(OFFER_WIRE) || rest.length > 0) return "bad"
  const span = parseSpan(named)
  if (span === null) return "bad"
  if (kind === "review") return { kind: "review", span }
  const path = url.searchParams.get("path")
  if (kind === "diff" && path !== null) return { kind: "diff", span, path }
  return "bad"
}

/** A diff past this many bytes of UTF-8 is refused, not sent. */
export const MAX_DIFF_BYTES = 1024 * 1024

export type OfferRead =
  | { readonly kind: "review"; readonly span: DiffSpan }
  | { readonly kind: "diff"; readonly span: DiffSpan; readonly path: string }
  | {
      readonly kind: "refused"
      readonly status: 400 | 404
      readonly reason: string
    }

// A C0 control or DEL: refused before it reaches a jj fileset.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the characters refused
const CONTROL = /[\u0000-\u001f\u007f]/

/**
 * What a request may read, so it reaches nothing of your repo but what a
 * thread made: a revision an open offer holds now (what a take would bring),
 * or a range between two commits one lane's turns recorded (an ask's work,
 * ADR-0056). The commits read are the records', never the request's strings.
 */
export function planOfferRead(
  facts: {
    readonly offers: ReadonlyMap<LaneName, OfferRecord>
    readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  },
  ask: OfferAsk,
): OfferRead {
  const span = recordedSpan(facts, ask.span)
  if (span === null)
    return {
      kind: "refused",
      status: 404,
      reason:
        ask.span.kind === "revision"
          ? "no open offer holds it"
          : "no lane recorded both",
    }
  if (ask.kind === "review") return { kind: "review", span }
  if (ask.path === "" || CONTROL.test(ask.path))
    return { kind: "refused", status: 400, reason: "not a path" }
  return { kind: "diff", span, path: ask.path }
}

function recordedSpan(
  facts: Parameters<typeof planOfferRead>[0],
  asked: AskedSpan,
): DiffSpan | null {
  if (asked.kind === "revision") {
    const commit = [...facts.offers.values()]
      .flatMap(o => (o.taken === null ? o.commits : []))
      .find(c => c === asked.commit)
    return commit === undefined ? null : { kind: "revision", commit }
  }
  const named = (c: string) =>
    [...facts.revisions.values()].filter(r => r.commit === c)
  for (const f of named(asked.from))
    for (const t of named(asked.to))
      if (f.lane === t.lane && f.commit !== null && t.commit !== null)
        return { kind: "range", from: f.commit, to: t.commit }
  return null
}

export type OfferAnswer =
  | { readonly kind: "review"; readonly review: RevisionReview }
  | { readonly kind: "diff"; readonly text: string }
  | {
      readonly kind: "refused"
      readonly status: 400 | 404 | 413 | 502
      readonly reason: string
    }

/** A review as jj printed it, unchecked: decoded, or 502, the host's read having failed. */
export function answerReview(got: unknown): OfferAnswer {
  const review = decodeRevisionReview(got)
  return review === undefined
    ? { kind: "refused", status: 502, reason: "the host's read failed" }
    : { kind: "review", review }
}

/** A diff as jj printed it: 502 when the read failed, 413 past `MAX_DIFF_BYTES`. */
export function answerDiff(text: string | null): OfferAnswer {
  if (text === null)
    return { kind: "refused", status: 502, reason: "the host's read failed" }
  if (new TextEncoder().encode(text).length > MAX_DIFF_BYTES)
    return { kind: "refused", status: 413, reason: "too large to show here" }
  return { kind: "diff", text }
}

/**
 * What a take was shown (ADR-0065), from the record the page drew: the
 * offer's ledger, and whether it conflicted. With no record, it was shown no
 * offer.
 */
export const offerSeen = (record: OfferRecord | undefined): OfferSeen => ({
  ledger: record?.ledger ?? null,
  conflicted: (record?.conflicts.length ?? 0) > 0,
})
