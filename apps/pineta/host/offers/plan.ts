// host/offers/plan — what an offer step does, pure (ADR-0038).
//
// `planRefresh` (marginalia) decides which branch a refresh takes. What each
// branch then runs on your repo, and what it writes, is decided here, so the
// executors in `refresh.ts` and `act.ts` only carry it out. It lives in the
// host because it joins marginalia's plans and `@pineta/lanes`' step
// planners, and `@pineta/lanes` declares only `@pineta/core`.

import type { CommitId, HaveRecord, LaneName, OfferRecord } from "@pineta/core"
import {
  type LaneStep,
  type OfferFacts,
  type OfferSource,
  ONTO_BOOKMARK,
  planAbandonOffer,
  planFollowOffer,
  planRefreshOffer,
  planTakeOffer,
} from "@pineta/lanes"
import type { RefreshPlan } from "@pineta/marginalia"

/** What an offer's record is written from: what the host built or kept. */
export interface OfferAt {
  readonly bookmark: string
  readonly tip: CommitId
  readonly start: readonly CommitId[]
  /** The commits the host wrote, bottom first. */
  readonly commits: readonly CommitId[]
  readonly changes: readonly string[]
  readonly target: string
  readonly stale: boolean
  readonly described: boolean
  readonly edited: boolean
}

/**
 * An offer's record, from what the host wrote (`at`) and the facts read
 * after. `commits` are the facts' (a review names each revision as it is
 * now); `host.wrote` keeps what the host wrote, the baseline for your edits.
 */
export function offerRecord(
  lane: LaneName,
  at: OfferAt,
  facts: Pick<OfferFacts, "files" | "conflicts" | "commits">,
  yourEdits: readonly string[],
  now: number,
): OfferRecord {
  return {
    lane,
    size: at.changes.length,
    stale: at.stale,
    files: facts.files,
    conflicts: facts.conflicts,
    yourEdits,
    described: at.described,
    edited: at.edited,
    bookmark: at.bookmark,
    taken: null,
    commits: facts.commits,
    at: now,
    host: {
      changes: [...at.changes],
      wrote: [...at.commits],
      tip: at.tip,
      start: [...at.start],
    },
  }
}

/** What a refresh was planned from, besides `planRefresh`'s answer. */
export interface RefreshContext {
  readonly root: string
  readonly tip: CommitId
  readonly start: readonly CommitId[]
  readonly target: string
  /** The offer's line until an agent describes it. */
  readonly wip: string
  /** The lane's offer while it is open, else null. */
  readonly open: OfferRecord | null
  /** The open offer's revisions are still in your repo, or divergent there. */
  readonly live: boolean
}

export interface OfferEffects {
  /** The jj steps to run on your repo, in order. */
  readonly steps: readonly LaneStep[]
  /** What to do after them. */
  readonly after:
    | { readonly kind: "nothing" }
    | { readonly kind: "build"; readonly sources: readonly OfferSource[] }
    /**
     * Write the record. `reread`: the steps rewrote this offer, so its
     * commits are read after them. `known`: the facts read before planning
     * still hold, and are written as they are.
     */
    | {
        readonly kind: "record"
        readonly at: OfferAt
        readonly reread: OfferRecord | null
        readonly known: boolean
      }
    /** Your edit and the host's crossed: repair each revision, then record. */
    | {
        readonly kind: "repair"
        readonly offer: OfferRecord
        readonly at: OfferAt
      }
    | { readonly kind: "remove" }
  /** The offer's content changed, so it is described once the lane stops. */
  readonly built: boolean
}

const NOTHING: OfferEffects = {
  steps: [],
  after: { kind: "nothing" },
  built: false,
}

/** What each `planRefresh` answer does to a lane's offer. */
export function planOfferEffects(
  plan: RefreshPlan,
  c: RefreshContext,
): OfferEffects {
  if (plan === "build")
    return {
      steps: [],
      after: {
        kind: "build",
        sources: [{ commit: c.tip, description: c.wip }],
      },
      built: true,
    }
  const { open } = c
  if (open === null) return NOTHING
  // What the record keeps unless the plan changes it.
  const kept: OfferAt = {
    bookmark: open.bookmark,
    tip: open.host.tip,
    start: open.host.start,
    commits: open.host.wrote,
    changes: open.host.changes,
    target: c.target,
    stale: open.stale,
    described: open.described,
    edited: open.edited,
  }
  const record = (at: OfferAt, reread: OfferRecord | null, built = false) =>
    ({
      steps: [],
      after: { kind: "record", at, reread, known: false },
      built,
    }) as const
  switch (plan) {
    case "none":
      return c.live
        ? {
            steps: [],
            after: {
              kind: "record",
              at: kept,
              reread: null,
              known: true,
            },
            built: false,
          }
        : NOTHING
    case "follow": {
      const [change] = open.host.changes
      if (change === undefined) return NOTHING
      return {
        ...record(
          {
            ...kept,
            tip: c.tip,
            start: c.start,
            described: false,
            edited: false,
          },
          open,
          true,
        ),
        // A described offer holds more now: it is a work in progress again.
        steps: planFollowOffer({
          root: c.root,
          change,
          start: c.start,
          tip: c.tip,
          target: c.target,
          description: open.described ? c.wip : null,
        }),
      }
    }
    case "withdraw":
      return {
        steps: planAbandonOffer(c.root, open.host.changes),
        after: { kind: "remove" },
        built: false,
      }
    case "refresh": {
      const [bottom] = open.host.changes
      if (bottom === undefined) return NOTHING
      return {
        ...record({ ...kept, edited: false }, open),
        steps: planRefreshOffer(c.root, bottom, c.target),
      }
    }
    case "stale":
    case "leave":
      return record(
        {
          ...kept,
          stale: plan === "stale" || open.stale,
          edited: plan === "leave",
        },
        null,
      )
    case "repair":
      return {
        steps: [],
        after: {
          kind: "repair",
          offer: open,
          at: { ...kept, edited: true },
        },
        built: false,
      }
  }
}

/**
 * A take (ADR-0038): its steps, the have it delivers (the lane's tip, so the
 * next offer starts above it), and the record marked taken. Null for an offer
 * with no revisions.
 */
export function planTake(input: {
  readonly root: string
  readonly lane: LaneName
  readonly offer: OfferRecord
  readonly target: string
  /** Your `@` sits on the target: the offer goes under your work. */
  readonly underYou: boolean
  readonly now: number
}): {
  readonly steps: readonly LaneStep[]
  readonly have: HaveRecord
  readonly taken: OfferRecord
} | null {
  const { offer, now } = input
  const [bottom] = offer.host.changes
  const top = offer.host.changes.at(-1)
  if (bottom === undefined || top === undefined) return null
  return {
    steps: planTakeOffer({
      root: input.root,
      bookmark: offer.bookmark,
      bottom,
      top,
      target: input.target,
      underYou: input.underYou,
      onto: input.target === ONTO_BOOKMARK,
    }),
    have: {
      lane: input.lane,
      commit: offer.host.tip,
      kind: "delivered",
      at: now,
    },
    taken: { ...offer, taken: top, at: now },
  }
}
