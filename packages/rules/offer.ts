// offer — what the host decides about a lane's offer in your repo (ADR-0038,
// ADR-0060, ADR-0067), pure, over the facts `@pinetrie/repo` gathers.
//
// Each decision is a value typed in `@pinetrie/core` (`core/offers.ts`) that
// carries the facts its steps need: what a trigger does (`planRefresh`), a
// acceptance (`planOfferAcceptance`), a split's stack or a squash rebuilt
// (`planStackEnded`, `planRebuild`), and a commit message (`planDescribeAsk`,
// `planDescribeSettle`). `@pinetrie/repo` turns each into jj steps
// (`offerEffects`), and the host only connects the two. What a record says
// (`offerStatus`) and the record itself (`offerRecord`, `planYourEdits`) are
// here too, since the host and the page read them alike. The page's view is
// `offer-view.ts`, the review's wire `review.ts`, and the commit message's
// format `@pinetrie/core`'s `trailers.ts`.

import {
  type CommitId,
  changesOf,
  commitId,
  type DescribeDecision,
  ERR,
  type ErrCode,
  isWipLine,
  type LaneName,
  type OfferAcceptanceDecision,
  type OfferAcceptanceFacts,
  type OfferGather,
  type OfferInRepo,
  type OfferLedger,
  type OfferNow,
  type OfferRecord,
  type OfferSeen,
  type OfferSource,
  type Rebuild,
  type RefreshDecision,
  type RefreshFacts,
  type RevisionFacts,
  type StackFacts,
  type ThreadBase,
  type ThreadName,
} from "@pinetrie/core"
import { Type } from "typebox"
import { CommitSchema, decodeAt, laneKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const OfferRecordSchema = Type.Object({
  size: Type.Integer({ minimum: 1 }),
  stale: Type.Boolean(),
  files: Type.Array(Type.String()),
  conflicts: Type.Array(Type.String()),
  // Absent from a record written before it (ADR-0072): read as none.
  startConflicts: Type.Optional(Type.Array(Type.String())),
  yourEdits: Type.Array(Type.String()),
  described: Type.Boolean(),
  edited: Type.Boolean(),
  bookmark: Type.String({ minLength: 1 }),
  // Optional only while records written before ADR-0100 hold
  // `integratedAs` instead; a record holds one of the two.
  acceptedAs: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  // pre-accepted: before ADR-0100, what `acceptedAs` was called. Read,
  // never written. Delete once every host has rewritten its offer records.
  integratedAs: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  commits: Type.Array(CommitSchema),
  // Absent from a record written before it (ADR-0065): read as null.
  ledger: Type.Optional(
    Type.Union([
      Type.Object({
        source: CommitSchema,
        start: Type.Array(CommitSchema, { minItems: 1 }),
      }),
      Type.Null(),
    ]),
  ),
  at: Type.Number(),
})

/** Each lane's offer in your repo, at the lane. */
export const OFFER: RecordSpec<OfferRecord, LaneName, "session"> = {
  namespace: "pinetrie.offer",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => ({
    ...contents,
    files: [...contents.files],
    conflicts: [...contents.conflicts],
    startConflicts: [...contents.startConflicts],
    yourEdits: [...contents.yourEdits],
    commits: [...contents.commits],
    ledger:
      contents.ledger === null
        ? null
        : { source: contents.ledger.source, start: [...contents.ledger.start] },
  }),
  // Field by field: an older record has a `host` key, what the host once
  // kept for itself, which a spread would carry along.
  decode: (contents, key) =>
    decodeAt(OfferRecordSchema, contents, laneKey(key), (r, lane) => ({
      lane,
      size: r.size,
      stale: r.stale,
      files: r.files,
      conflicts: r.conflicts,
      startConflicts: r.startConflicts ?? [],
      yourEdits: r.yourEdits,
      described: r.described,
      edited: r.edited,
      bookmark: r.bookmark,
      // A record written since ADR-0100 says `acceptedAs`, null or not.
      acceptedAs:
        r.acceptedAs !== undefined ? r.acceptedAs : (r.integratedAs ?? null),
      commits: r.commits.map(commitId),
      ledger:
        r.ledger === undefined || r.ledger === null
          ? null
          : {
              source: commitId(r.ledger.source),
              start: r.ledger.start.map(commitId),
            },
      at: r.at,
    })),
}

/**
 * Whether you edited a revision: a version an operation not the host's made
 * changed it since the host's newest version (S73). A revision the host
 * never made is yours. A rebase jj made because you reworded a commit below
 * is your operation but changes nothing (S48 item 7), so it is no edit.
 */
const revisionEdited = (r: RevisionFacts): boolean =>
  !r.reached || r.yoursChanged

/**
 * Whether you edited the offer: a revision edited, a commit of yours between
 * its revisions, or its bottom moved off its base (S48 item 7). The host
 * never touches it again; nothing it writes later can hide your version.
 */
const offerEdited = (offer: OfferNow): boolean =>
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
  !sameStart(ledger.start, now.start)

/** Two starts name the same commits: a merge's parents in any order. */
const sameStart = (a: readonly CommitId[], b: readonly CommitId[]): boolean =>
  a.length === b.length && a.every(c => b.includes(c))

/**
 * What a trigger does to a lane's offer (`RefreshDecision`). An archived
 * thread's offer goes whatever its state, an edited one too: an offer is
 * immutable, so editing one is an expert's own act. An offer is built only
 * when the lane's work is known to change a file from a known start
 * (ADR-0067): one built from less would be empty, or bring back what you
 * accepted, and withdrawing it would repeat on every poll, since each step moves
 * your repo's operation head. An unknown answer keeps what is there. An
 * untraced start withdraws an offer the host made, and touches nothing else.
 */
export function planRefresh(facts: RefreshFacts): RefreshDecision {
  const { offer } = facts
  if (facts.kind === "archived")
    return offer === null ? { kind: "forget" } : { kind: "withdraw", offer }
  if (facts.kind === "untraced") {
    if (offer === null) return { kind: "forget" }
    return offer.kind === "divergent" || offerEdited(offer)
      ? { kind: "untouched" }
      : { kind: "withdraw", offer }
  }
  const { place, work } = facts
  const { tip, start } = place
  const reached = start.length === 1 && start[0] === tip
  if (offer === null)
    return work !== "some" || reached
      ? { kind: "forget" }
      : { kind: "build", place }
  if (offer.kind === "divergent")
    return { kind: "repair", place, changes: offer.changes }
  if (offerEdited(offer)) return { kind: "leave", place }
  if (work === "none") return { kind: "withdraw", offer }
  if (offerMoved(offer.ledger, { tip, start })) {
    if (offer.revisions.length > 1) return { kind: "stale", place }
    return reached
      ? { kind: "withdraw", offer }
      : { kind: "rebuild", place, offer }
  }
  return offer.onTarget
    ? { kind: "none", place }
    : { kind: "refresh", place, offer }
}

/** What a stack's check found: how many files differ from the lane's tip. */
function acceptStack(input: {
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

// ── where an acceptance goes, and what a record says ──────────────

/**
 * Where an acceptance may move a bookmark to the offer (ADR-0060): a forward move,
 * never a rebase, so every destination gives the same tree.
 */
export interface OfferAcceptanceDestination {
  readonly bookmark: string
  readonly kind: "accepted" | "wip"
  /** Commits of yours that land with the offer: the WIP's, onto accepted work. */
  readonly bringsAlong: number
  /** What moves is immutable after: accepted work. */
  readonly final: boolean
}

/**
 * The bookmarks an acceptance may move to the offer, the default first (ADR-0060):
 * the one the lane is based on, and, for a WIP, accepted work too, landing the
 * WIP's commits with it. Only a clean offer lands on accepted work: accepted work is
 * immutable, and a conflict accepted into it would stay in its history. A WIP
 * gone without landing has none; one that landed is accepted work's. Pure.
 */
export function offerAcceptanceDestinations(input: {
  readonly base: ThreadBase
  readonly state: "ok" | "landed" | "gone"
  readonly acceptedBookmark: string
  readonly conflicted: boolean
  /** The WIP's commits above accepted work, for a WIP base. */
  readonly wipAhead: number
}): readonly OfferAcceptanceDestination[] {
  const line = (bringsAlong: number): OfferAcceptanceDestination[] =>
    input.conflicted
      ? []
      : [
          {
            bookmark: input.acceptedBookmark,
            kind: "accepted",
            bringsAlong,
            final: true,
          },
        ]
  if (input.state === "gone") return []
  if (input.base.kind === "accepted" || input.state === "landed") return line(0)
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
 * What a lane's `pinetrie.offer` record says, decoded once (ADR-0067): every
 * reader of the page switches on this, never on the record's fields.
 * - `none`: no record;
 * - `accepted`: accepted, as the change `as`;
 * - `held`: open, but it brings no file: accepted work already holds its work,
 *   by a route the ledger does not record (S89), so there is nothing to add;
 * - `open`: work to add. One you edited is open whatever its files: it is
 *   yours.
 */
export type OfferStatus =
  | { readonly kind: "none" }
  | { readonly kind: "accepted"; readonly as: string }
  | { readonly kind: "held"; readonly record: OfferRecord }
  | { readonly kind: "open"; readonly record: OfferRecord }

export function offerStatus(record: OfferRecord | undefined): OfferStatus {
  if (record === undefined) return { kind: "none" }
  if (record.acceptedAs !== null)
    return { kind: "accepted", as: record.acceptedAs }
  const held = record.files.length === 0 && !record.edited
  return { kind: held ? "held" : "open", record }
}

/** A record not yet accepted: open, or held (`offerStatus`). */
export const isNotYetAccepted = (
  status: OfferStatus,
): status is Extract<OfferStatus, { readonly kind: "open" | "held" }> =>
  status.kind === "open" || status.kind === "held"

// ── its record, the page's cache (ADR-0060) ──────────────────────────────

/**
 * An offer's record, from the offer as your repo holds it (ADR-0060): what it
 * holds, whether an agent described it, whether you edited it, and whether
 * a stack's lane moved on (`offerMoved`, the rule `planRefresh` uses).
 * `commits` are what a review may read.
 */
export function offerRecord(input: {
  readonly lane: LaneName
  readonly name: ThreadName
  readonly offer: OfferNow
  /** The lane's tip and where an offer starts now; none for an untraced start, where a stack reads as stale. */
  readonly place: {
    readonly tip: CommitId
    readonly start: readonly CommitId[]
  }
  /** Files `@` changes (`SharedFacts.editing`): its files among them are your edits. */
  readonly editing: ReadonlySet<string>
  readonly now: number
}): OfferRecord {
  const { offer } = input
  const size = offer.revisions.length
  return {
    lane: input.lane,
    size,
    stale: size > 1 && offerMoved(offer.ledger, input.place),
    files: offer.files,
    conflicts: offer.conflicts,
    startConflicts: offer.startConflicts,
    yourEdits: offer.files.filter(f => input.editing.has(f)),
    described: !isWipLine(input.name, offer.firstLine),
    edited: offerEdited(offer),
    bookmark: offer.bookmark,
    acceptedAs: null,
    commits: offer.revisions.map(r => r.commit),
    ledger: offer.ledger,
    at: input.now,
  }
}

/**
 * Only `@` moved: each record not yet accepted with `yourEdits` its files that `@`
 * changes now. Unchanged ones come back too: the host writes only what
 * changed.
 */
export const planYourEdits = (
  records: Iterable<OfferRecord>,
  editing: ReadonlySet<string>,
): OfferRecord[] =>
  [...records]
    .filter(r => isNotYetAccepted(offerStatus(r)))
    .map(r => ({ ...r, yourEdits: r.files.filter(f => editing.has(f)) }))

// ── an acceptance (ADR-0060, ADR-0065) ─────────────────────────────

/** A gather with an offer and the thread's name: what an acceptance, a rebuild or a description acts on. */
type NamedOffer = OfferGather & {
  readonly offer: OfferInRepo
  readonly name: ThreadName
}

const namedOffer = (gathered: OfferGather | null): gathered is NamedOffer =>
  gathered !== null && gathered.offer !== null && gathered.name !== undefined

/** Two ledgers name the same work: the same source, and the same start as a set. */
const sameLedger = (a: OfferLedger | null, b: OfferLedger | null): boolean =>
  a === null || b === null
    ? a === b
    : a.source === b.source && sameStart(a.start, b.start)

/**
 * Whether the offer is not the one an acceptance was shown (ADR-0065): it
 * brings other work (another ledger), or it conflicts now and did not then.
 * A rebase onto a moved target keeps the ledger, and so does your edit: both
 * are accepted.
 */
const offerChanged = (offer: OfferNow, seen: OfferSeen): boolean =>
  !sameLedger(offer.ledger, seen.ledger) ||
  (offer.conflicts.length > 0 && !seen.conflicted)

/**
 * An acceptance (ADR-0060), decided from the offer read in its own
 * command: the destination asked for (`to`, else the default), which must be
 * one of the offer's destinations now (`offerAcceptanceDestinations`) and at
 * or below its bottom's parent, so the move is forward; and the record marked
 * accepted. What you have of the lane is the offer's own `Pinetrie-Source`,
 * which the accepted-offer commit keeps.
 * Refused, in this order: no offer, a WIP gone, nothing shown, a divergent
 * offer, other work than was shown, no such destination.
 */
export function planOfferAcceptance(input: {
  readonly lane: LaneName
  readonly gathered: OfferGather | null
  /** What the acceptance was shown (ADR-0065); null when it names none. */
  readonly seen: OfferSeen | null
  /** What only an acceptance reads (`gatherOfferAcceptance`); null without an offer to accept. */
  readonly acceptance: OfferAcceptanceFacts | null
  /** Files `@` changes, for the accepted record's `yourEdits`. */
  readonly editing: ReadonlySet<string>
  /** Accepted work's bookmark. */
  readonly acceptedBookmark: string
  readonly to: string | null
  readonly now: number
}): OfferAcceptanceDecision {
  const refused = (code: ErrCode): OfferAcceptanceDecision => ({
    kind: "refused",
    code,
  })
  const { gathered, seen, acceptance } = input
  if (!namedOffer(gathered)) return refused(ERR.NO_OFFER)
  const { place, offer, name } = gathered
  if (place.kind === "gone") return refused(ERR.BAD_DESTINATION)
  // An acceptance that names no offer was shown none.
  if (seen === null) return refused(ERR.OFFER_CHANGED)
  if (offer.kind === "divergent") return refused(ERR.NO_OFFER)
  const top = offer.revisions.at(-1)?.change
  if (top === undefined || acceptance === null) return refused(ERR.NO_OFFER)
  if (offerChanged(offer, seen)) return refused(ERR.OFFER_CHANGED)
  const destinations = offerAcceptanceDestinations({
    base: place.base.base,
    state: place.state,
    acceptedBookmark: input.acceptedBookmark,
    conflicted: offer.conflicts.length > 0,
    wipAhead: acceptance.wipAhead,
  })
  const destination =
    input.to === null
      ? destinations[0]
      : destinations.find(d => d.bookmark === input.to)
  if (destination === undefined || !acceptance.below.has(destination.bookmark))
    return refused(ERR.BAD_DESTINATION)
  const record = offerRecord({
    lane: input.lane,
    name,
    offer,
    // An acceptance moves a bookmark and needs no start. An untraced start leaves
    // only an offer you edited; with none, a stack reads stale.
    place: {
      tip: place.tip,
      start: place.kind === "placed" ? place.start : [],
    },
    editing: input.editing,
    now: input.now,
  })
  return {
    kind: "accept",
    name,
    bookmark: record.bookmark,
    destination: destination.bookmark,
    top,
    accepted: { ...record, acceptedAs: top, at: input.now },
  }
}

// ── an offer rebuilt (ADR-0038) ───────────────────────────────────────────

/** An offer rebuilt, or why not. */
type RebuildDecision<Refusal> =
  | ({ readonly kind: "rebuild" } & Rebuild)
  | { readonly kind: "refused"; readonly why: Refusal }

/**
 * A split's run ended (ADR-0038): its stack replaces the offer when it holds
 * exactly the lane tip's files, built at the offer's place from the stack's
 * own start and tip, which its ledger names. An untraced place accepts it: the
 * stack brings its own start. Why not, in words the agent reads.
 */
export function planStackEnded(input: {
  readonly stack: {
    readonly start: readonly CommitId[]
    readonly tip: CommitId
  }
  readonly facts: StackFacts | "no-top"
  readonly gathered: OfferGather | null
}): RebuildDecision<string> {
  const refused = (why: string) => ({ kind: "refused", why }) as const
  const { facts, gathered } = input
  if (facts === "no-top") return refused("the stack's bookmark was not set")
  const verdict = acceptStack({
    revisions: facts.revisions.length,
    differing: facts.differing,
  })
  if (!verdict.ok) return refused(verdict.reason)
  if (gathered === null) return refused("the thread's lane is not in your repo")
  const { place, name, offer } = gathered
  if (name === undefined) return refused("the thread has no name yet")
  if (place.kind === "gone")
    return refused("the thread's base is gone: continue it on accepted work")
  return {
    kind: "rebuild",
    name,
    place: {
      kind: "placed",
      tip: input.stack.tip,
      base: place.base,
      state: place.state,
      target: place.target,
      start: input.stack.start,
    },
    changes: offer === null ? [] : changesOf(offer),
    sources: facts.revisions,
  }
}

/**
 * A squash or a refresh (ADR-0038): the offer rebuilt from the lane's tip as
 * one revision on its WIP line, which an untraced start cannot do.
 */
export function planRebuild(
  gathered: OfferGather | null,
  wip: string,
): RebuildDecision<ErrCode> {
  const refused = (why: ErrCode) => ({ kind: "refused", why }) as const
  if (!namedOffer(gathered)) return refused(ERR.NO_OFFER)
  const { place, offer, name } = gathered
  if (place.kind === "gone") return refused(ERR.BAD_DESTINATION)
  if (place.kind === "untraced") return refused(ERR.NO_OFFER)
  const sources: OfferSource[] = [{ commit: place.tip, description: wip }]
  return { kind: "rebuild", name, place, changes: changesOf(offer), sources }
}

// ── its commit message (ADR-0038) ─────────────────────────────────────────

/**
 * Whether an offer is one to ask a commit message for: a single revision,
 * not yours, and still on its WIP line unless `force` asks again.
 */
const describeWanted = (
  offer: OfferInRepo | null,
  name: ThreadName,
  force: boolean,
): offer is OfferNow =>
  offer?.kind === "offer" &&
  offer.revisions.length === 1 &&
  !offerEdited(offer) &&
  (force || isWipLine(name, offer.firstLine))

/**
 * Asked to describe the offer again: refused without a named offer; the
 * request itself checks the rest (`planDescribeAsk`).
 */
export const planDescribeAgain = (
  gathered: OfferGather | null,
): ErrCode | null => (namedOffer(gathered) ? null : ERR.NO_OFFER)

/** The commit a message is asked for (`describeWanted`): the offer's one revision; null for none. */
export function planDescribeAsk(
  gathered: OfferGather | null,
  force: boolean,
): CommitId | null {
  if (!namedOffer(gathered)) return null
  const { offer, name } = gathered
  if (!describeWanted(offer, name, force)) return null
  return offer.revisions[0]?.commit ?? null
}

/**
 * Whether a message the model wrote for `asked` is still wanted, decided
 * from the offer read again in the command that writes it: the offer was
 * rebuilt from its lane, or you edited it, while the model wrote, and the
 * message describes what it held then. With no ledger, the place's tip and
 * start are the one it keeps.
 */
export function planDescribeSettle(input: {
  readonly gathered: OfferGather | null
  readonly asked: CommitId
  readonly force: boolean
}): DescribeDecision | null {
  const { gathered } = input
  if (!namedOffer(gathered)) return null
  const { place, offer, name } = gathered
  if (place.kind !== "placed" || !describeWanted(offer, name, input.force))
    return null
  const [revision] = offer.revisions
  if (revision === undefined || revision.commit !== input.asked) return null
  return {
    name,
    place,
    change: revision.change,
    ledger: offer.ledger ?? { source: place.tip, start: place.start },
  }
}
