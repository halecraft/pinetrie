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
// (`startOfOffer`), are in `@pineta/lanes`.

import {
  type CommitId,
  type DiffSpan,
  type EntryId,
  firstLine,
  type LandingRecord,
  type LaneName,
  type OfferRecord,
  type RevisionFacts,
  type RevisionRecord,
  type RevisionReview,
  spanKey,
  type ThreadName,
  TRAILERS,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { fitNewest, LEFT_OUT_NOTE, leftOut } from "./request.ts"

/**
 * Whether you edited a revision since the host last wrote it: it differs in
 * description or change, and the evolog does not show only the host's own
 * versions between (S73). A walk that never reached the host's commit
 * proves nothing, so that revision counts as yours.
 */
export const revisionEdited = (r: RevisionFacts): boolean =>
  !(r.sameDescription && r.sameChange) &&
  (r.since === null || !r.since.reached || r.since.yoursChanged)

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
  const edited = !offer.placed || offer.revisions.some(revisionEdited)
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
  `${message.trim()}\n\n${TRAILERS.thread}: ${at.name}\n${TRAILERS.lane}: ${at.lane}\n${TRAILERS.entry}: ${at.entry}\n`

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
 * The version of what `/offer/` answers: `REVISION_READ` and the range read
 * (`@pineta/lanes`), `decodeRevisionReview`, `fileDiff`'s flags, and the
 * URLs' spans. Every answer is cached as immutable under a URL holding it,
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
