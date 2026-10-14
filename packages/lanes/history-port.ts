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
  CommitId,
  CopyRefusal,
  EntryId,
  ForkStart,
  LaneBase,
  ReadyCopy,
  ThreadId,
} from "@pinetrie/core"
import type { LaneStep } from "./plan.ts"

/** Where a file is read: accepted work, or a lane's newest commit or its start. */
export type Point =
  | { readonly kind: "accepted" }
  | { readonly kind: "tip"; readonly lane: ThreadId }
  | { readonly kind: "start"; readonly lane: ThreadId }

/**
 * A file read at a point: its text, null when the point has no such file,
 * with the revision it was read at as the adapter names it, for a log; or
 * none, when the point is not there (a lane with no commit there yet).
 */
export type FileAt =
  | {
      readonly kind: "read"
      readonly at: string
      readonly text: string | null
    }
  | { readonly kind: "no-point" }

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

/** A turn's revision, and whether it, or the bookmark when it has none, is conflicted. */
export interface TurnCommitted {
  readonly commit: CommitId | null
  readonly conflicted: boolean
}

/** A revision on one side of a merge, and the files it touched of those asked about. */
export interface TouchedRevision {
  readonly description: string
  readonly paths: readonly string[]
}

/** What an update found in the lane after its merge (`mergeUpdate`). */
export type Merged =
  /**
   * Nothing to merge. `mark` is the commit naming accepted work, when the plan
   * asked for one, made on `ours`.
   */
  | {
      readonly kind: "nothing"
      readonly ours: CommitId
      readonly mark: CommitId | null
    }
  | {
      readonly kind: "clean"
      /** The commit merged: accepted work's, or the WIP's copy. */
      readonly from: CommitId
      /** The lane's revision before the merge. */
      readonly ours: CommitId
      readonly merge: CommitId
      /** The files the merge changed under the lane. */
      readonly files: readonly string[]
      /** The titles of the commits that came in (`MergePlan.came`), without the accepted-offer commits joined. */
      readonly commits: readonly string[]
    }
  | {
      readonly kind: "conflicted"
      readonly from: CommitId
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

/** A turn recorded: its revision, the bookmark before it, its paths and conflicts. */
export interface TurnMade {
  /** The turn's revision; null when it has none. */
  readonly committed: CommitId | null
  /** The lane's newest revision before the turn. */
  readonly newest: CommitId | null
  /** The paths changed since `newest`; none without a revision. */
  readonly paths: readonly string[]
  /** The files conflicted in the turn's revision, else in `newest`. */
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
