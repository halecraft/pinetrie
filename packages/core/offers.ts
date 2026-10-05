// core/offers — an offer and the integration line in your repo: the facts
// `@pinetrie/repo` reads, and the decisions it carries out (ADR-0038,
// ADR-0060).
//
// A format or type that lanes or repo must read, write or name lives in core
// too, since neither can declare @pinetrie/rules. This file holds the
// facts `repo` reads of an offer and the decisions it carries out:
// `@pinetrie/rules` decides from the one and returns the other, and neither package
// imports the other.

import type {
  BaseRecord,
  CommitId,
  ERR,
  ErrCode,
  LaneBase,
  LineRecord,
  OfferRecord,
  ThreadName,
} from "./index.ts"

/**
 * What a revision's evolog says since the host's newest version of it
 * (`readOffer` in `@pinetrie/repo` reads it, `revisionEdited` in
 * `@pinetrie/rules` decides from it): whether the walk back reached a
 * version the host made, and whether a version an operation not the host's
 * made on the way changed it. Read from the repo, never from a record the
 * host kept, which can be lost after its jj steps landed (S73).
 */
export interface RevisionFacts {
  readonly reached: boolean
  readonly yoursChanged: boolean
}

/** One revision of an offer, as your repo holds it now. */
export interface OfferRevision {
  readonly commit: CommitId
  /** Its change id: what jj steps on it name (S48 item 2). */
  readonly change: string
  readonly since: RevisionFacts
}

/** An offer's ledger, as its top's message carries it (`offerLedger`). */
export interface OfferLedger {
  /** The lane tip it holds (`Pinetrie-Source`). */
  readonly source: CommitId
  /** Where it starts (`Pinetrie-Start`). */
  readonly start: readonly CommitId[]
}

/**
 * What an offer integration was shown (ADR-0065): the offer's ledger, and
 * whether it conflicted. An integration whose offer now brings other work,
 * or newly conflicts, is refused (`OFFER_CHANGED`).
 */
export interface OfferSeen {
  readonly ledger: OfferLedger | null
  readonly conflicted: boolean
}

/**
 * An offer as your repo holds it now (`readOffer` in `@pinetrie/repo`): all
 * the host decides an offer from. Facts only; what they mean is decided in
 * `@pinetrie/rules` (`planRefresh`, `offerEdited`, `offerMoved`) and
 * `isWipLine` (`trailers.ts`). A divergent offer is only its change ids: the repair needs
 * nothing more, and every other read would name one of two commits.
 */
export type OfferInRepo =
  | {
      readonly kind: "offer"
      /** The bookmark it was found under (`offerBookmark`). */
      readonly bookmark: string
      /** Bottom first. */
      readonly revisions: readonly OfferRevision[]
      /** Each revision's parent is the one below it: no commit of yours between. */
      readonly chained: boolean
      readonly ledger: OfferLedger | null
      /** The top's first line. */
      readonly firstLine: string
      /** The bottom's parent is an ancestor of the target (S48 item 7). */
      readonly placed: boolean
      /** The bottom's parents are exactly the target. */
      readonly onTarget: boolean
      readonly files: readonly string[]
      /** Files conflicting in its top: with the work under it (S48 item 3). */
      readonly conflicts: readonly string[]
      /** Files conflicted where its ledger says it starts, read only when it conflicts (ADR-0072). */
      readonly startConflicts: readonly string[]
    }
  | { readonly kind: "divergent"; readonly changes: readonly string[] }

/**
 * Whether a lane's work since its start changes any file, as far as jj can
 * tell (ADR-0067): `unknown` when it cannot, which never builds an offer.
 */
export type WorkChanges = "none" | "some" | "unknown"

/**
 * Where a lane's offer starts (ADR-0060), or `untraced`: an integrated-offer
 * commit of this lane above its base names no source (`untracedLanes`), so
 * no start can leave out what it brought, and nothing is offered until the
 * lane catches up past it (ADR-0067).
 */
export type StartRead =
  | { readonly kind: "known"; readonly start: readonly CommitId[] }
  | {
      readonly kind: "untraced"
      readonly integratedOfferCommits: readonly CommitId[]
    }

/** One revision of an offer: the lane commit whose files it has, and its message. */
export interface OfferSource {
  readonly commit: CommitId
  readonly description: string
}

/** Each revision's change id, bottom first: what jj steps on it name. */
export const changesOf = (offer: OfferInRepo): readonly string[] =>
  offer.kind === "divergent"
    ? offer.changes
    : offer.revisions.map(r => r.change)

/** An offer as your repo holds it, not divergent. */
export type OfferNow = Extract<OfferInRepo, { readonly kind: "offer" }>

// ── where an offer sits (the gathers in `@pinetrie/repo`) ───────────────────

/** A place an offer can be built on: a target, and a known start. */
export interface Placed {
  readonly kind: "placed"
  /** The lane's tip in your repo. */
  readonly tip: CommitId
  readonly base: LaneBase
  /** A WIP base's state (`wipState`, `@pinetrie/repo`); "ok" for the line. */
  readonly state: "ok" | "landed"
  /** Where the offer sits: the line's commit, or the WIP bookmark's. */
  readonly target: CommitId
  /** Where it starts (`startOfOffer`). */
  readonly start: readonly CommitId[]
}

/**
 * Where a lane's offer sits and starts, read from your repo now (ADR-0060),
 * decided once by the gather.
 */
export type OfferPlace =
  /** A WIP gone without landing: nothing sits anywhere, and nothing moves. */
  | { readonly kind: "gone"; readonly tip: CommitId; readonly base: LaneBase }
  /**
   * An integrated-offer commit of the lane names no source (S97): nothing is
   * built here, but an offer that is here can be integrated, since an
   * integration moves a bookmark and needs no start.
   */
  | {
      readonly kind: "untraced"
      readonly tip: CommitId
      readonly base: LaneBase
      readonly state: "ok" | "landed"
      readonly target: CommitId
    }
  | Placed

/** One offer step's gather: where the offer sits, and the offer there. */
export interface OfferGather {
  readonly place: OfferPlace
  /** Null offer with no name yet: an offer is found by its thread's name. */
  readonly name: ThreadName | undefined
  readonly offer: OfferInRepo | null
  /**
   * The lane's base record as the repo says it now, what catching up would
   * change and its untraced integrated-offer commits with it: the host writes it when it
   * differs from the page's (ADR-0060).
   */
  readonly base: BaseRecord
}

/** What a refresh decides from (`planRefresh`). */
export type RefreshFacts =
  /** The thread's root is archived (ADR-0029): the offer alone, read against the line. */
  | { readonly kind: "archived"; readonly offer: OfferInRepo | null }
  /** An integrated-offer commit of the lane names no source (S97). */
  | { readonly kind: "untraced"; readonly offer: OfferInRepo | null }
  | {
      readonly kind: "placed"
      readonly place: Placed
      /** Whether the lane's work since its start changes any file. */
      readonly work: WorkChanges
      readonly offer: OfferInRepo | null
    }

/** What only an offer integration reads; the rest is in its gather's place. */
export interface OfferIntegrationFacts {
  /** The WIP's commits above the line; 0 for a lane on the line. */
  readonly wipAhead: number
  /**
   * Of the line's bookmark and, on a WIP, the WIP's, those at or below the
   * offer's bottom's parent: a move to one is forward.
   */
  readonly below: ReadonlySet<string>
}

/** A split's stack, as it is in your repo after its run (ADR-0038). */
export interface StackFacts {
  /** Bottom first, each with its message. */
  readonly revisions: readonly OfferSource[]
  /** The files its top differs from the lane's tip in. */
  readonly differing: readonly string[]
}

// ── what `@pinetrie/rules` decides, and `@pinetrie/repo` carries out ──────────

/**
 * An offer built anew at `place` from `sources`, after abandoning `changes`:
 * a build (no changes), a squash or refresh, or a split's stack.
 */
export interface Rebuild {
  /** The thread's name: the offer's bookmark and its messages' trailer. */
  readonly name: ThreadName
  readonly place: Placed
  readonly changes: readonly string[]
  readonly sources: readonly OfferSource[]
}

/** What a trigger does to a lane's offer (`planRefresh`). */
export type RefreshDecision =
  /** No offer, and none to build: remove a record left from one. */
  | { readonly kind: "forget" }
  /** Abandon it and remove its record: archived, untraced, reached, or its work changes no file. */
  | { readonly kind: "withdraw"; readonly offer: OfferInRepo }
  /** No offer: build one from the lane's tip (ADR-0067: known work, from a known start). */
  | { readonly kind: "build"; readonly place: Placed }
  /** The lane, or where it starts, moved under a single offer you did not edit: rebuild it in place (ADR-0039). */
  | {
      readonly kind: "rebuild"
      readonly place: Placed
      readonly offer: OfferNow
    }
  /** Only the target moved: rebase it there. */
  | {
      readonly kind: "refresh"
      readonly place: Placed
      readonly offer: OfferNow
    }
  /** Nothing runs, and the record is written from the offer: unchanged, a stack the lane moved past, or yours. */
  | { readonly kind: "none" | "stale" | "leave"; readonly place: Placed }
  /** Your edit and the host's crossed: keep yours (S48 item 8). */
  | {
      readonly kind: "repair"
      readonly place: Placed
      readonly changes: readonly string[]
    }
  /**
   * Untraced, and divergent or yours: nothing runs, and the record stays as
   * it is. A gap ADR-0067's untraced start leaves: such an offer is neither
   * repaired nor recorded until the lane catches up past the integrated-offer
   * commit.
   */
  | { readonly kind: "untouched" }

/** An offer integration (`planOfferIntegration`): the bookmark it moves and the revision it moves to, or why not. */
export type OfferIntegrationDecision =
  | {
      readonly kind: "integrate"
      readonly name: ThreadName
      readonly bookmark: string
      readonly destination: string
      /** The offer's top's change id. */
      readonly top: string
      /** Its record, marked integrated. */
      readonly integrated: OfferRecord
    }
  | { readonly kind: "refused"; readonly code: ErrCode }

/** The single revision to describe (`planDescribeSettle`), and the ledger its message keeps. */
export interface DescribeDecision {
  readonly name: ThreadName
  readonly place: Placed
  readonly change: string
  readonly ledger: OfferLedger
}

// ── the integration line (ADR-0060, ADR-0061) ─────────────────────────────

/**
 * What the host reads of the line, each time it looks (`lineFacts` in
 * `@pinetrie/repo`): its commit, the WIPs above it and your work against it,
 * as its record holds them, and your repo's `immutable_heads()` and
 * `revsets.log` as jj resolves them (null for jj's own).
 */
export interface LineFacts
  extends Pick<LineRecord, "commit" | "wips" | "published" | "yours"> {
  readonly heads: string | null
  readonly log: string | null
}

/**
 * A publish (ADR-0090), decided before its first step: on the host's own
 * machine, your files catch up with the line first (`catchUp`), and your
 * commits below `@` move onto it with the publish bookmark (`integrate`).
 */
export interface PublishDecision {
  readonly kind: "publish"
  readonly onto: string
  readonly publish: string
  /** Rebase `@` onto the line first, as you. */
  readonly catchUp: boolean
  /** The line moves with the publish bookmark, to your `@-`. */
  readonly integrate: boolean
}

/** A `line` command (`planLineAction`): what it does, or why not. */
export type LineDecision =
  /** Set the line up, writing exactly the heads and log its record proposed. */
  | {
      readonly kind: "setup"
      readonly onto: string
      readonly heads: string
      readonly log: string
    }
  | PublishDecision
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * The bookmark move that ends a publish (`planPublishMove`): the publish
 * bookmark to the line, or, with `integrate`, both to your `@-`.
 */
export interface PublishMove {
  readonly onto: string
  readonly publish: string
  readonly integrate: boolean
}

/**
 * A publish's second round (`planPublishFinish`), from the line as read after
 * the catch-up: the move, or the catch-up's operation reverted (S111).
 */
export type PublishFinish =
  | ({ readonly kind: "move" } & PublishMove)
  | {
      readonly kind: "undo"
      readonly op: string
      readonly code: typeof ERR.YOURS_CONFLICT | typeof ERR.NOT_FAST_FORWARD
    }
