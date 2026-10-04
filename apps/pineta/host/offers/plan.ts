// host/offers/plan — what an offer step does, pure (ADR-0038).
//
// `planRefresh` (marginalia) decides which branch a refresh takes. What each
// branch then runs on your repo, and what it writes, is decided here, so the
// executors in `refresh.ts` and `act.ts` only carry it out. It lives in the
// host because it joins marginalia's plans and `@pineta/repo`'s step
// planners, and neither package knows the other.

import {
  type BaseRecord,
  type CommitId,
  ERR,
  type ErrCode,
  type LaneName,
  type LineAction,
  type LineRecord,
  type OfferInRepo,
  type OfferLedger,
  type OfferRecord,
  type OfferSeen,
  type ThreadName,
  type ValueWrite,
} from "@pineta/core"
import { type LineConfig, offerBookmark } from "@pineta/lanes"
import {
  BASE,
  isWipLine,
  type OfferNow,
  offerEdited,
  offerMessage,
  offerMoved,
  type RefreshPlan,
  setIfChanged,
  type TakeDestination,
} from "@pineta/marginalia"
import {
  immutableHeads,
  type LineFacts,
  logRevset,
  type Moved,
  type OfferSource,
  planAbandonOffer,
  planFollow,
  planFollowOffer,
  planLand,
  planLineSetup,
  planRefreshOffer,
  planTakeOffer,
  type RepoStep,
} from "@pineta/repo"

/** Each revision's change id, bottom first: what jj steps on it name. */
export const changesOf = (offer: OfferInRepo): readonly string[] =>
  offer.kind === "divergent"
    ? offer.changes
    : offer.revisions.map(r => r.change)

/**
 * An offer's record, the page's cache, from the offer as your repo holds it
 * (ADR-0060): what it holds, whether an agent described it, whether you
 * edited it, and whether a stack's lane moved on (`offerMoved`, the rule
 * `planRefresh` uses). `commits` are what a review may read.
 */
export function offerRecord(input: {
  readonly lane: LaneName
  readonly name: ThreadName
  readonly offer: OfferNow
  /** The lane's tip and where an offer starts now. */
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
    bookmark: offerBookmark(input.name),
    taken: null,
    commits: offer.revisions.map(r => r.commit),
    ledger: offer.ledger,
    at: input.now,
  }
}

/**
 * The lane's base as the repo says it now, and the `pineta.base` record the
 * page has: a refresh or a take writes the first when it differs (ADR-0060).
 * The gather reads it and writes nothing.
 */
export interface BaseNow {
  readonly next: BaseRecord
  readonly stored: BaseRecord | undefined
}

/** The writes that bring the page's base record up to the repo's; none for no base. */
export const baseWrites = (base: BaseNow | null): readonly ValueWrite[] =>
  base === null ? [] : setIfChanged(BASE, base.next, base.stored)

/** What a refresh was planned from, besides `planRefresh`'s answer. */
export interface RefreshContext {
  /** The lane's base record; null for an archived thread, which has no place. */
  readonly base: BaseNow | null
  /**
   * The lane's tip, where an offer starts and where it sits; null for an
   * archived thread, which `planRefresh` only withdraws or forgets.
   */
  readonly place: {
    readonly tip: CommitId
    readonly start: readonly CommitId[]
    readonly target: string
  } | null
  /** The WIP line, before its trailers (`wipDescription`). */
  readonly wip: string
  /** The host's trailers for the offer's messages (`offerMessage`). */
  readonly trailers: {
    readonly lane: LaneName
    readonly name: ThreadName
    readonly entry: string
  }
  /** The offer as your repo holds it, read before planning; null with none. */
  readonly offer: OfferInRepo | null
}

export interface OfferEffects {
  /** Document writes first: the lane's base record, when it changed. */
  readonly writes: readonly ValueWrite[]
  /** The jj steps to run on your repo, in order. */
  readonly steps: readonly RepoStep[]
  /** What to do after them. */
  readonly after:
    | { readonly kind: "nothing" }
    /** Build a new offer from these sources, their messages without trailers. */
    | { readonly kind: "build"; readonly sources: readonly OfferSource[] }
    /** Write the record from the offer as your repo holds it after the steps. */
    | { readonly kind: "record" }
    /** Your edit and the host's crossed: repair each revision, then record. */
    | { readonly kind: "repair"; readonly changes: readonly string[] }
    | { readonly kind: "remove" }
  /** The offer's content changed, so it is described once the lane stops. */
  readonly built: boolean
}

const NOTHING: Omit<OfferEffects, "writes"> = {
  steps: [],
  after: { kind: "nothing" },
  built: false,
}

const REMOVE: Omit<OfferEffects, "writes"> = {
  steps: [],
  after: { kind: "remove" },
  built: false,
}

/**
 * What each `planRefresh` answer does to a lane's offer. Only `withdraw` and
 * `forget` act without a place; any other answer without one does nothing.
 */
export function planOfferEffects(
  plan: RefreshPlan,
  c: RefreshContext,
): OfferEffects {
  return { writes: baseWrites(c.base), ...effectsOf(plan, c) }
}

function effectsOf(
  plan: RefreshPlan,
  c: RefreshContext,
): Omit<OfferEffects, "writes"> {
  if (plan === "forget") return REMOVE
  const { place } = c
  if (plan === "build")
    return place === null
      ? NOTHING
      : {
          steps: [],
          after: {
            kind: "build",
            sources: [{ commit: place.tip, description: c.wip }],
          },
          built: true,
        }
  if (c.offer === null) return plan === "withdraw" ? REMOVE : NOTHING
  const changes = changesOf(c.offer)
  const [bottom] = changes
  if (bottom === undefined) return NOTHING
  if (plan === "withdraw")
    return { ...REMOVE, steps: planAbandonOffer(changes) }
  if (place === null) return NOTHING
  const record = { kind: "record" } as const
  switch (plan) {
    case "none":
    case "stale":
    case "leave":
      return { steps: [], after: record, built: false }
    case "follow":
      // It holds more now: a work in progress again, its ledger the new tip
      // and start (ADR-0060).
      return {
        steps: planFollowOffer({
          change: bottom,
          start: place.start,
          tip: place.tip,
          target: place.target,
          description: offerMessage(c.wip, {
            ...c.trailers,
            ledger: { source: place.tip, start: place.start },
          }),
        }),
        after: record,
        built: true,
      }
    case "refresh":
      return {
        steps: planRefreshOffer(bottom, place.target),
        after: record,
        built: false,
      }
    case "repair":
      return { steps: [], after: { kind: "repair", changes }, built: false }
  }
}

/** Two ledgers name the same work: the same source, and the same start as a set. */
const sameLedger = (a: OfferLedger | null, b: OfferLedger | null): boolean =>
  a === null || b === null
    ? a === b
    : a.source === b.source &&
      a.start.length === b.start.length &&
      a.start.every(c => b.start.includes(c))

/**
 * Whether the offer is not the one a take was shown (ADR-0065): it brings
 * other work (another ledger), or it conflicts now and did not then. A
 * rebase onto a moved target keeps the ledger, and so does your edit: both
 * are taken.
 */
export const offerChanged = (offer: OfferNow, seen: OfferSeen): boolean =>
  !sameLedger(offer.ledger, seen.ledger) ||
  (offer.conflicts.length > 0 && !seen.conflicted)

/**
 * A take (ADR-0060), decided from the offer read in its own step: the
 * destination asked for (`to`, else the default), which must be one of the
 * offer's destinations now and below the offer, so the move is forward;
 * then its steps and the record marked taken. Refused otherwise. What you
 * have of the lane is the offer's own `Pineta-Source`, which the take keeps.
 */
export function planTake(input: {
  readonly base: BaseNow
  /** What the take was shown (ADR-0065). */
  readonly seen: OfferSeen
  readonly offer: OfferNow
  /** Its record now (`offerRecord`), which the take marks taken. */
  readonly record: OfferRecord
  readonly destinations: readonly TakeDestination[]
  readonly to: string | null
  /** Whether `bookmark` points at, or below, the offer's bottom's parent. */
  readonly below: (bookmark: string) => boolean
  readonly now: number
}):
  | {
      readonly kind: "take"
      /** The lane's base record, when it changed: written before the steps. */
      readonly writes: readonly ValueWrite[]
      readonly steps: readonly RepoStep[]
      readonly taken: OfferRecord
    }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { record, now } = input
  const top = input.offer.revisions.at(-1)?.change
  if (top === undefined) return { kind: "refused", code: ERR.NO_OFFER }
  if (offerChanged(input.offer, input.seen))
    return { kind: "refused", code: ERR.OFFER_CHANGED }
  const destination =
    input.to === null
      ? input.destinations[0]
      : input.destinations.find(d => d.bookmark === input.to)
  if (destination === undefined || !input.below(destination.bookmark))
    return { kind: "refused", code: ERR.BAD_DESTINATION }
  return {
    kind: "take",
    writes: baseWrites(input.base),
    steps: planTakeOffer({
      bookmark: record.bookmark,
      top,
      destination: destination.bookmark,
    }),
    taken: { ...record, taken: top, at: now },
  }
}

/**
 * The line's record, from what the host read of it (ADR-0060): what setting
 * it up would write to your repo's `immutable_heads()` (`immutableHeads`),
 * and whether this host takes `line` commands.
 */
export function planLineRecord(
  facts: LineFacts,
  line: LineConfig,
  commands: boolean,
): LineRecord {
  return {
    onto: line.onto,
    wipPrefix: line.wipPrefix,
    commit: facts.commit,
    heads: {
      current: facts.heads,
      proposed: immutableHeads(line, facts.heads),
    },
    log: { current: facts.log, proposed: logRevset(facts.log) },
    wips: facts.wips,
    yours: facts.yours,
    commands,
  }
}

/**
 * A `line` command, decided from the record read in its own step: refused
 * on a host that admits others (it acts on the repo as its owner), refused
 * when there is nothing to do, else its steps. Setting up writes exactly the
 * immutable heads and log the record proposed, the text you were shown.
 */
export function planLineAction(
  action: LineAction,
  record: LineRecord,
):
  | { readonly kind: "refused"; readonly code: ErrCode }
  | { readonly kind: "steps"; readonly steps: readonly RepoStep[] } {
  if (!record.commands) return { kind: "refused", code: ERR.NOT_YOURS }
  switch (action) {
    case "setup":
      return record.commit !== null
        ? { kind: "refused", code: ERR.REFUSED }
        : {
            kind: "steps",
            steps: planLineSetup({
              onto: record.onto,
              heads: record.heads.proposed,
              log: record.log.proposed,
            }),
          }
    case "land":
      if (record.commit === null) return { kind: "refused", code: ERR.NO_LINE }
      return record.yours.ahead === null || record.yours.ahead === 0
        ? { kind: "refused", code: ERR.REFUSED }
        : { kind: "steps", steps: planLand({ onto: record.onto }) }
    case "follow":
      // Only with a preview: it is what you were shown before you chose it.
      if (record.commit === null) return { kind: "refused", code: ERR.NO_LINE }
      return record.yours.follow === null
        ? { kind: "refused", code: ERR.REFUSED }
        : { kind: "steps", steps: planFollow({ onto: record.onto }) }
  }
}

/**
 * What a move the owner observed marks for a refresh (ADR-0065): the line's
 * record, and each lane whose offer it may change. Everything, the line, a
 * WIP or the first observation (`all`), marks every named lane and every
 * open record. `@` alone (`yours`) marks no lane: it changes only each
 * record's `yourEdits` and the line's preview, which one shared read
 * rewrites (`shared`). A lane's ref marks that lane, and an offer bookmark
 * the lane its thread names.
 */
export function planMarks(input: {
  readonly moved: Moved
  readonly names: ReadonlyMap<LaneName, ThreadName>
  /** Lanes with an open offer record: how an offer you abandoned is built again. */
  readonly open: readonly LaneName[]
}): {
  readonly line: boolean
  /** Rewrite what `@` changes: each open record's `yourEdits`, and the line's record. */
  readonly shared: boolean
  readonly lanes: readonly LaneName[]
} {
  const { moved } = input
  const every = moved.all
  const byName = new Map([...input.names].map(([lane, name]) => [name, lane]))
  const lanes = new Set<LaneName>([
    ...(every ? [...input.names.keys(), ...input.open] : []),
    ...moved.lanes,
    ...[...moved.offers].flatMap(name => {
      const lane = byName.get(name)
      return lane === undefined ? [] : [lane]
    }),
  ])
  return { line: every, shared: !every && moved.yours, lanes: [...lanes] }
}
