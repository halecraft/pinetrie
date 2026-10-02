// host/offers/plan — what an offer step does, pure (ADR-0038).
//
// `planRefresh` (marginalia) decides which branch a refresh takes. What each
// branch then runs on your repo, and what it writes, is decided here, so the
// executors in `refresh.ts` and `act.ts` only carry it out. It lives in the
// host because it joins marginalia's plans and `@pineta/lanes`' step
// planners, and `@pineta/lanes` declares only `@pineta/core`.

import {
  type CommitId,
  ERR,
  type ErrCode,
  type LaneName,
  type LineAction,
  type LineRecord,
  type OfferRecord,
  type RevisionFacts,
} from "@pineta/core"
import {
  immutableHeads,
  type LaneStep,
  type LineConfig,
  type LineFacts,
  logRevset,
  type OfferFacts,
  type OfferSource,
  planAbandonOffer,
  planFollowOffer,
  planLand,
  planLineSetup,
  planRefreshOffer,
  planTakeOffer,
} from "@pineta/lanes"
import type { RefreshPlan, TakeDestination } from "@pineta/marginalia"

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
  /** The offer's line until an agent describes it, with its ledger (`withLedger`). */
  readonly wip: string
  /** The lane's offer while it is open, else null. */
  readonly open: OfferRecord | null
  /** The open offer's revisions are still in your repo, or divergent there. */
  readonly live: boolean
  /**
   * The open offer's commits as the facts found them, when they differ from
   * what the host wrote (`readBaseline`); null otherwise, or with no facts.
   */
  readonly read: readonly CommitId[] | null
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

/**
 * The commits a refresh may take as the baseline for your edits: those read
 * now, only when a revision differs from what the host last wrote. Then the
 * host's own write was lost from the record (S73), or you edited it, which
 * `leave` sees against `wrote` regardless. A revision jj only rebased, as
 * when you reword the commit under it, keeps `wrote`. Pure.
 */
export const readBaseline = (facts: {
  readonly commits: readonly CommitId[]
  readonly revisions: readonly RevisionFacts[]
}): readonly CommitId[] | null =>
  facts.revisions.some(r => !(r.sameDescription && r.sameChange))
    ? facts.commits
    : null

/**
 * What an offer was built from and on, for `planRefresh`: the repo's ledger,
 * its top's `Pineta-Source` and `Pineta-Start` (ADR-0060), so a record
 * lost or stale costs nothing. The record's copy only for an offer whose
 * message you rewrote without them. Pure.
 */
export const builtOf = (
  ledger: {
    readonly source: CommitId
    readonly start: readonly CommitId[]
  } | null,
  open: OfferRecord,
): { readonly builtFrom: CommitId; readonly builtOn: readonly CommitId[] } =>
  ledger === null
    ? { builtFrom: open.host.tip, builtOn: open.host.start }
    : { builtFrom: ledger.source, builtOn: ledger.start }

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
  // The baseline your edits are seen against: what the host wrote, or, for
  // an offer that is not yours, what was read now. A host write whose record
  // was lost is then the baseline from the first trigger on (S73).
  const read =
    c.read !== null && c.read.length === open.host.changes.length
      ? c.read
      : null
  const baseline =
    plan === "leave" || plan === "repair"
      ? open.host.wrote
      : (read ?? open.host.wrote)
  // What the record keeps unless the plan changes it.
  const kept: OfferAt = {
    bookmark: open.bookmark,
    tip: open.host.tip,
    start: open.host.start,
    commits: baseline,
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
        // It holds more now: a work in progress again, its ledger the new
        // tip and start (ADR-0060).
        steps: planFollowOffer({
          root: c.root,
          change,
          start: c.start,
          tip: c.tip,
          target: c.target,
          description: c.wip,
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
 * A take (ADR-0060), decided from facts read in its own step: the
 * destination asked for (`to`, else the default), which must be one of the
 * offer's destinations now and below the offer, so the move is forward;
 * then its steps and the record marked taken. Refused otherwise, or for an
 * offer with no revisions. What you have of the lane is the offer's own
 * `Pineta-Source`, which the take keeps.
 */
export function planTake(input: {
  readonly root: string
  readonly offer: OfferRecord
  readonly destinations: readonly TakeDestination[]
  readonly to: string | null
  /** Whether `bookmark` points at, or below, the offer's bottom's parent. */
  readonly below: (bookmark: string) => boolean
  readonly now: number
}):
  | {
      readonly kind: "take"
      readonly steps: readonly LaneStep[]
      readonly taken: OfferRecord
    }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { offer, now } = input
  const top = offer.host.changes.at(-1)
  if (top === undefined) return { kind: "refused", code: ERR.NO_OFFER }
  const destination =
    input.to === null
      ? input.destinations[0]
      : input.destinations.find(d => d.bookmark === input.to)
  if (destination === undefined || !input.below(destination.bookmark))
    return { kind: "refused", code: ERR.BAD_DESTINATION }
  return {
    kind: "take",
    steps: planTakeOffer({
      root: input.root,
      bookmark: offer.bookmark,
      top,
      destination: destination.bookmark,
    }),
    taken: { ...offer, taken: top, at: now },
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
  root: string,
):
  | { readonly kind: "refused"; readonly code: ErrCode }
  | { readonly kind: "steps"; readonly steps: readonly LaneStep[] } {
  if (!record.commands) return { kind: "refused", code: ERR.NOT_YOURS }
  switch (action) {
    case "setup":
      return record.commit !== null
        ? { kind: "refused", code: ERR.REFUSED }
        : {
            kind: "steps",
            steps: planLineSetup({
              root,
              onto: record.onto,
              heads: record.heads.proposed,
              log: record.log.proposed,
            }),
          }
    case "land":
      if (record.commit === null) return { kind: "refused", code: ERR.NO_LINE }
      return record.yours.ahead === null || record.yours.ahead === 0
        ? { kind: "refused", code: ERR.REFUSED }
        : { kind: "steps", steps: planLand({ root, onto: record.onto }) }
  }
}
