// review — the review's wire: its URLs, what a request may read, and how it
// is answered, here since the host and the page both import it.

import {
  type DiffSpan,
  type EntryId,
  isFolderStateId,
  type ProposedChangesRecord,
  type RevisionRecord,
  type RevisionReview,
  spanKey,
  type ThreadId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { proposedChangesStatus } from "./proposed.ts"

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

const WideningSchema = Type.Union([
  Type.Object({ kind: Type.Literal("ssh") }),
  Type.Object({ kind: Type.Literal("nested") }),
  Type.Object({ kind: Type.Literal("env"), name: Type.String() }),
  Type.Object({ kind: Type.Literal("mount"), target: Type.String() }),
  Type.Object({ kind: Type.Literal("hostPort"), port: Type.Integer() }),
  Type.Object({ kind: Type.Literal("shared"), path: Type.String() }),
])

const RevisionReviewSchema = Type.Object({
  description: Type.String(),
  files: Type.Array(ReviewFileSchema),
  widenings: Type.Array(WideningSchema),
})

/**
 * A revision's review from the wire: jj's output on the host, the host's
 * answer in the page. A change to it bumps `REVIEW_WIRE`.
 */
export const decodeRevisionReview = (
  value: unknown,
): RevisionReview | undefined => decodeWith(RevisionReviewSchema, value, r => r)

/**
 * The version of what `/review/` answers: `REVISION_READ` (`@pinetrie/lanes`)
 * and the range read (`@pinetrie/jj`), `decodeRevisionReview`, `fileDiff`'s
 * flags, and the URLs' spans. Every answer is cached as immutable under a URL holding it,
 * so a change to any of them bumps it, or pages keep the old shape.
 */
export const REVIEW_WIRE = 3

/**
 * What a page asks: a span's review, or one file's diff in it. The commits
 * are the request's strings until `planReviewRead` finds them in a record.
 */
export type ReviewAsk =
  | { readonly kind: "review"; readonly span: AskedSpan }
  | {
      readonly kind: "diff"
      readonly span: AskedSpan
      readonly path: string
    }

/** A span as a request names it (`DiffSpan`), its commits unchecked. */
type AskedSpan =
  | { readonly kind: "revision"; readonly commit: string }
  | { readonly kind: "range"; readonly from: string; readonly to: string }

const REVIEW_PREFIX = "/review/"

/**
 * A span's review: `/review/<REVIEW_WIRE>/review/<commit>` for a revision,
 * `…/review/<from>..<to>` for a range (`spanKey`).
 */
export const reviewUrl = (span: DiffSpan): string =>
  `${REVIEW_PREFIX}${REVIEW_WIRE}/review/${spanKey(span)}`

/** One file's diff in a span: `/review/<REVIEW_WIRE>/diff/<span>?path=…`. */
export const diffUrl = (span: DiffSpan, path: string): string =>
  `${REVIEW_PREFIX}${REVIEW_WIRE}/diff/${spanKey(span)}?${new URLSearchParams({ path })}`

const HEX = /^[0-9a-f]+$/

/** A point as a URL names it: a jj commit's hex, or a folder state's id. */
const isPointText = (text: string): boolean =>
  HEX.test(text) || isFolderStateId(text)

/** `spanKey`'s string back as a span, or null. A revision is a commit's alone. */
function parseSpan(text: string | undefined): AskedSpan | null {
  if (text === undefined) return null
  const [from, to, ...more] = text.split("..")
  if (from === undefined || !isPointText(from) || more.length > 0) return null
  if (to === undefined)
    return HEX.test(from) ? { kind: "revision", commit: from } : null
  return isPointText(to) ? { kind: "range", from, to } : null
}

/**
 * A `/review/` path as an ask: `bad` for anything else under `/review/`,
 * another version included, so the host answers only the wire it speaks;
 * null for a path outside it.
 */
export function parseReviewPath(url: URL): ReviewAsk | "bad" | null {
  if (url.pathname !== "/review" && !url.pathname.startsWith(REVIEW_PREFIX))
    return null
  const [version, kind, named, ...rest] = url.pathname
    .slice(REVIEW_PREFIX.length)
    .split("/")
  if (version !== String(REVIEW_WIRE) || rest.length > 0) return "bad"
  const span = parseSpan(named)
  if (span === null) return "bad"
  if (kind === "review") return { kind: "review", span }
  const path = url.searchParams.get("path")
  if (kind === "diff" && path !== null) return { kind: "diff", span, path }
  return "bad"
}

/** A diff past this many bytes of UTF-8 is refused, not sent. */
export const MAX_DIFF_BYTES = 1024 * 1024

/**
 * A span found in a record: proposed changes' revision, or a range one lane's
 * turns recorded or folder proposed changes hold, naming that lane, whose
 * points only it can read.
 */
export type RecordedSpan =
  | Extract<DiffSpan, { readonly kind: "revision" }>
  | (Extract<DiffSpan, { readonly kind: "range" }> & {
      readonly lane: ThreadId
    })

type ReviewRead =
  | { readonly kind: "review"; readonly span: RecordedSpan }
  | {
      readonly kind: "diff"
      readonly span: RecordedSpan
      readonly path: string
    }
  | {
      readonly kind: "refused"
      readonly status: 400 | 404
      readonly reason: string
    }

// A C0 control or DEL: refused before it reaches a jj fileset.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the characters refused
const CONTROL = /[\u0000-\u001f\u007f]/

/**
 * What a request may read, so it reaches nothing of your repo but what a thread
 * made: a revision open proposed changes hold now (what accepting it would
 * bring), a range between two states one lane's turns recorded (an ask's work),
 * or an open folder proposed changes' `start..tip`, with that lane. The ids
 * read are the records', never the request's strings.
 */
export function planReviewRead(
  facts: {
    readonly proposedByLane: ReadonlyMap<ThreadId, ProposedChangesRecord>
    readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  },
  ask: ReviewAsk,
): ReviewRead {
  const span = recordedSpan(facts, ask.span)
  if (span === null)
    return {
      kind: "refused",
      status: 404,
      reason:
        ask.span.kind === "revision"
          ? "no open proposed changes hold it"
          : "no lane recorded both",
    }
  if (ask.kind === "review") return { kind: "review", span }
  if (ask.path === "" || CONTROL.test(ask.path))
    return { kind: "refused", status: 400, reason: "not a path" }
  return { kind: "diff", span, path: ask.path }
}

function recordedSpan(
  facts: Parameters<typeof planReviewRead>[0],
  asked: AskedSpan,
): RecordedSpan | null {
  if (asked.kind === "revision") {
    const commit = [...facts.proposedByLane.values()]
      .flatMap(o =>
        o.kind === "jj" && proposedChangesStatus(o).kind === "open"
          ? o.commits
          : [],
      )
      .find(c => c === asked.commit)
    return commit === undefined ? null : { kind: "revision", commit }
  }
  for (const o of facts.proposedByLane.values())
    if (
      o.kind === "folder" &&
      proposedChangesStatus(o).kind === "open" &&
      o.start === asked.from &&
      o.tip === asked.to
    )
      return { kind: "range", from: o.start, to: o.tip, lane: o.lane }
  const named = (p: string) =>
    [...facts.revisions.values()].filter(r => r.point === p)
  for (const f of named(asked.from))
    for (const t of named(asked.to))
      if (f.lane === t.lane && f.point !== null && t.point !== null)
        return { kind: "range", from: f.point, to: t.point, lane: f.lane }
  return null
}

export type ReviewAnswer =
  | { readonly kind: "review"; readonly review: RevisionReview }
  | { readonly kind: "diff"; readonly text: string }
  | {
      readonly kind: "refused"
      readonly status: 400 | 404 | 413 | 502
      readonly reason: string
    }

/** A review as jj printed it, unchecked: decoded, or 502, the host's read having failed. */
export function answerReview(got: unknown): ReviewAnswer {
  const review = decodeRevisionReview(got)
  return review === undefined
    ? { kind: "refused", status: 502, reason: "the host's read failed" }
    : { kind: "review", review }
}

/** A diff as jj printed it: 502 when the read failed, 413 past `MAX_DIFF_BYTES`. */
export function answerDiff(text: string | null): ReviewAnswer {
  if (text === null)
    return { kind: "refused", status: 502, reason: "the host's read failed" }
  if (new TextEncoder().encode(text).length > MAX_DIFF_BYTES)
    return { kind: "refused", status: 413, reason: "too large to show here" }
  return { kind: "diff", text }
}
