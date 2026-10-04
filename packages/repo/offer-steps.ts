// repo/offer-steps — what a decision about an offer runs on your repo, and
// what the host does after (ADR-0038, ADR-0060).
//
// Marginalia decides (`planRefresh`, `planOfferTake`, `planStackEnded`,
// `planRebuild`, `planDescribeSettle`); these turn each decision into
// `RepoStep`s, pure. Every decision carries the facts its steps need, so
// each kind has exactly one translation, and none that runs nothing because
// a case cannot happen. The host runs the steps on the owner and carries out
// `after` (`executeOffer`).

import {
  changesOf,
  type DescribeDecision,
  type LaneName,
  type OfferRecord,
  type OfferSource,
  offerMessage,
  type Placed,
  type Rebuild,
  type RefreshDecision,
  type TakeDecision,
  type ThreadName,
} from "@pineta/core"
import {
  planAbandonOffer,
  planDescribe,
  planFollowOffer,
  planOffer,
  planRefreshOffer,
  planTakeOffer,
} from "./plan.ts"
import type { RepoStep } from "./step.ts"

/** Who an offer's messages name: the host's trailers (`offerMessage`). */
export interface OfferAt {
  readonly lane: LaneName
  readonly name: ThreadName
  /** The lane's tip entry, for `Pineta-Entry`. */
  readonly entry: string
}

/** What a build needs besides: the WIP line, and a fresh nonce its commits are named by (`nonceRevset`). */
export interface BuildAt extends OfferAt {
  /** The line an offer carries until an agent describes it (`wipDescription`). */
  readonly wip: string
  /** `pineta-offer-<uuid>`, fresh for each build: the host makes it. */
  readonly nonce: string
}

/** What a decision runs on your repo, and what the host does after. */
export interface OfferEffects {
  readonly steps: readonly RepoStep[]
  readonly after:
    | { readonly kind: "nothing" }
    /** Write the record from the offer at the place's target: read again only when steps ran. */
    | { readonly kind: "record"; readonly place: Placed }
    /** Your edit and the host's crossed: repair each change (`repairOffer`), then record. */
    | {
        readonly kind: "repair"
        readonly place: Placed
        readonly changes: readonly string[]
      }
    | { readonly kind: "remove" }
    /** A take: write the record marked taken. */
    | { readonly kind: "taken"; readonly record: OfferRecord }
  /** The offer's content changed: it is described once the lane stops. */
  readonly built: boolean
}

const NOTHING: OfferEffects = {
  steps: [],
  after: { kind: "nothing" },
  built: false,
}

/** Each source's message with the host's trailers and the ledger of the place it is built at. */
const sourcesAt = (
  rebuild: Rebuild,
  at: Omit<OfferAt, "name">,
): readonly OfferSource[] =>
  rebuild.sources.map(source => ({
    ...source,
    description: offerMessage(source.description, {
      lane: at.lane,
      entry: at.entry,
      name: rebuild.name,
      ledger: { source: rebuild.place.tip, start: rebuild.place.start },
    }),
  }))

/**
 * An offer built anew: its old revisions abandoned (none for a build), then
 * a commit per source on its start, rebased onto its target (`planOffer`),
 * then its record.
 */
export function rebuildEffects(
  rebuild: Rebuild,
  at: Omit<OfferAt, "name"> & { readonly nonce: string },
): OfferEffects {
  const { place } = rebuild
  return {
    steps: [
      ...planAbandonOffer(rebuild.changes),
      ...planOffer({
        name: rebuild.name,
        start: place.start,
        sources: sourcesAt(rebuild, at),
        target: place.target,
        nonce: at.nonce,
      }),
    ],
    after: { kind: "record", place },
    built: true,
  }
}

/** What each refresh decision runs, and what the host writes after. */
export function offerEffects(
  decision: RefreshDecision,
  at: BuildAt,
): OfferEffects {
  switch (decision.kind) {
    case "untouched":
      return NOTHING
    case "forget":
      return { steps: [], after: { kind: "remove" }, built: false }
    case "withdraw": {
      const changes = changesOf(decision.offer)
      return changes.length === 0
        ? NOTHING
        : {
            steps: planAbandonOffer(changes),
            after: { kind: "remove" },
            built: false,
          }
    }
    case "build":
      return rebuildEffects(
        {
          name: at.name,
          place: decision.place,
          changes: [],
          sources: [{ commit: decision.place.tip, description: at.wip }],
        },
        at,
      )
    case "follow": {
      // It holds more now: a work in progress again, its ledger the new tip
      // and start (ADR-0060).
      const { place, offer } = decision
      const [bottom] = changesOf(offer)
      if (bottom === undefined) return NOTHING
      return {
        steps: planFollowOffer({
          change: bottom,
          start: place.start,
          tip: place.tip,
          target: place.target,
          description: offerMessage(at.wip, {
            ...at,
            ledger: { source: place.tip, start: place.start },
          }),
        }),
        after: { kind: "record", place },
        built: true,
      }
    }
    case "refresh": {
      const [bottom] = changesOf(decision.offer)
      if (bottom === undefined) return NOTHING
      return {
        steps: planRefreshOffer(bottom, decision.place.target),
        after: { kind: "record", place: decision.place },
        built: false,
      }
    }
    case "none":
    case "stale":
    case "leave":
      return {
        steps: [],
        after: { kind: "record", place: decision.place },
        built: false,
      }
    case "repair":
      return {
        steps: [],
        after: {
          kind: "repair",
          place: decision.place,
          changes: decision.changes,
        },
        built: false,
      }
  }
}

/** A take (ADR-0060): the destination moved forward to the offer's top, the offer's bookmark deleted, then its record marked taken. */
export const takeEffects = (
  decision: Extract<TakeDecision, { readonly kind: "take" }>,
): OfferEffects => ({
  steps: planTakeOffer({
    bookmark: decision.bookmark,
    top: decision.top,
    destination: decision.destination,
  }),
  after: { kind: "taken", record: decision.taken },
  built: false,
})

/** An agent's commit message on the offer's one revision, with the host's trailers and its ledger, then its record. */
export const describeEffects = (
  decision: DescribeDecision,
  text: string,
  at: OfferAt,
): OfferEffects => ({
  steps: planDescribe(
    decision.change,
    offerMessage(text, { ...at, ledger: decision.ledger }),
  ),
  after: { kind: "record", place: decision.place },
  built: false,
})
