// review — the review's wire (ADR-0047, ADR-0056): its URLs, what a request
// may read, and how it is answered, here since the host and the page both
// import it. The reads are `@pineta/repo`'s (`revisionRead`, `fileDiff`).

import {
  type DiffSpan,
  type EntryId,
  type LaneName,
  type OfferRecord,
  type RevisionRecord,
  type RevisionReview,
  spanKey,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { offerStatus } from "./offer.ts"

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
      .flatMap(o => (offerStatus(o).kind === "open" ? o.commits : []))
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
