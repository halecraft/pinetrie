// lanes/history-port — what a lane's copy records and merges, whatever keeps
// its history: the port each kind of project's adapter implements. Lane work
// reaches it only through the registry's `withHistory`, which runs the
// caller's function on the lane's queue, so nothing changes a lane's history
// off its queue.
//
// A fork's setup and the base's checkout are steps the adapter gives, each
// in a type of its own: `planFork` takes only a `ForkSetup`, and
// `refreshBase` only a `BaseCheckout`.

import type {
  BaseMerge,
  CopyRefusal,
  EntryId,
  ForkStart,
  LaneBase,
  PointId,
  ReadyCopy,
  ThreadId,
} from "@pinetrie/core"
import type { LaneStep } from "./plan.ts"

/** Where a file is read: accepted work, or a lane's newest state or its start. */
export type ReadSite =
  | { readonly kind: "accepted" }
  | { readonly kind: "tip"; readonly lane: ThreadId }
  | { readonly kind: "start"; readonly lane: ThreadId }

/**
 * A file read at a site: its text, null when the site has no such file,
 * with the state it was read at as the adapter names it, for a log; or
 * none, when the site is not there (a lane with no state there yet).
 */
export type FileAt =
  | {
      readonly kind: "read"
      readonly at: string
      readonly text: string | null
    }
  | { readonly kind: "no-site" }

/**
 * Accepted work now, as the adapter read it: its states, and its checkout
 * of them on the base's disk, bound to the read that made it. Used in the
 * step that read it and never kept, since accepted work may move after; so
 * nothing turns a state back into the adapter's own terms.
 */
export interface AcceptedNow {
  /** Accepted work's states: none before it is set up. */
  readonly points: readonly PointId[]
  /** The checkout of `points`, on a fresh disk or on the base before. */
  checkout(fresh: boolean): BaseCheckout
}

declare const forkSetupBrand: unique symbol
/** The lane steps that make a cloned disk a fork, after its disk is restored. */
export interface ForkSetup {
  readonly steps: readonly LaneStep[]
  readonly [forkSetupBrand]: true
}
/** Only an adapter makes one, from its own fork steps. */
export const forkSetup = (steps: readonly LaneStep[]): ForkSetup =>
  ({ steps }) as ForkSetup

declare const baseCheckoutBrand: unique symbol
/** The lane steps that check accepted work out on the base's scratch lane. */
export interface BaseCheckout {
  readonly steps: readonly LaneStep[]
  readonly [baseCheckoutBrand]: true
}
/** Only an adapter makes one, from its own checkout steps. */
export const baseCheckout = (steps: readonly LaneStep[]): BaseCheckout =>
  ({ steps }) as BaseCheckout

/**
 * A turn's state, and whether it, or the lane's newest when it has none, is
 * conflicted: the shape once, for the port (`TurnCommitted`) and for what an
 * adapter reads in its own terms (jj's commits).
 */
export interface TurnCommittedOf<P extends string> {
  readonly point: P | null
  readonly conflicted: boolean
}
export type TurnCommitted = TurnCommittedOf<PointId>

/** A revision on one side of a merge, and the files it touched of those asked about. */
export interface TouchedRevision {
  readonly description: string
  readonly paths: readonly string[]
}

/**
 * What an update found in the lane after its merge: the shape once, for the
 * port (`Merged`) and for what an adapter reads in its own terms.
 */
export type MergedOf<P extends string> =
  /**
   * Nothing to merge. `mark` is the state naming accepted work, when the plan
   * asked for one, made on `ours`.
   */
  | {
      readonly kind: "nothing"
      readonly ours: P
      readonly mark: P | null
    }
  | {
      readonly kind: "clean"
      /** The state merged: accepted work's, the WIP's copy, or the parent's. */
      readonly from: P
      /** The lane's state before the merge. */
      readonly ours: P
      readonly merge: P
      /** The files the merge changed under the lane. */
      readonly files: readonly string[]
      /** The titles of the commits that came in (`MergePlan.came`), without the accepted-offer commits joined. */
      readonly commits: readonly string[]
    }
  | {
      readonly kind: "conflicted"
      readonly from: P
      /** Each conflicted file, with jj's markers. */
      readonly contents: readonly {
        readonly path: string
        readonly content: string
      }[]
      /**
       * The revisions on each side that touched any conflicted file, oldest
       * first; `theirs` without the accepted-offer commits joined.
       */
      readonly ours: readonly TouchedRevision[]
      readonly theirs: readonly TouchedRevision[]
    }
export type Merged = MergedOf<PointId>

/** What a change to the lane is recorded as: its title and its entry. */
export interface Edits {
  readonly title: string
  readonly entry: EntryId
}

/**
 * What the adapter does once a move is recorded, for the caller to run
 * where it runs now: for jj, the lane's fetch into your repo. Null when the
 * move needs nothing. The caller fires it after the snapshot step it queues,
 * so the work behind it never delays the snapshot or the next tool call.
 * Never a member named `then`: `await` would take the result for a promise.
 */
export type Follow = (() => void) | null

/** A turn recorded: its state, the lane's newest before it, its paths and conflicts. */
export interface TurnMade {
  /** The turn's state; null when it has none. */
  readonly committed: PointId | null
  /** The lane's newest state before the turn. */
  readonly newest: PointId | null
  /** The paths changed since `newest`; none without a state of its own. */
  readonly paths: readonly string[]
  /** The files conflicted at the turn's state, else at `newest`. */
  readonly conflicts: readonly string[]
  readonly follow: Follow
}

/** A merge's result, and what follows it. */
export type MergeDone = Merged & { readonly follow: Follow }

/** A lane's history, on its queue. */
export interface LaneHistory {
  /** A fork's setup on a disk cloned from its fork point. Pure. */
  forkSteps(start: ForkStart): ForkSetup
  /** What changed in the lane, committed as a turn; nothing when nothing did. */
  commit(edits: Edits): Promise<TurnCommitted>
  /** `commit`, with the revision's paths and conflicts. */
  recordTurn(edits: Edits): Promise<TurnMade>
  /** The lane's base, as its history names it; null for none. */
  base(): Promise<LaneBase | null>
  /** Whether the copy may take a merge: a `ReadyCopy`, or why not. */
  readyToMerge(): Promise<ReadyCopy | CopyRefusal>
  /**
   * `edits` committed when given, then `from` merged into a copy found
   * ready. The caller reads `edits` from the lane's document.
   */
  merge(
    ready: ReadyCopy,
    from: BaseMerge,
    edits: Edits | null,
  ): Promise<MergeDone>
  /** The files conflicted in the lane's working copy. */
  conflicts(): Promise<readonly string[]>
  /** What a disk restored from a snapshot needs before its first command. */
  afterRestore(): Promise<void>
}
