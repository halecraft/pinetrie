// lanes/history-port — what a lane's copy records and merges, whatever keeps
// its history: the port each kind of project's adapter implements. Lane work
// reaches it only through the registry's `withHistory`, which runs the
// caller's function on the lane's queue, so nothing changes a lane's history
// off its queue.
//
// A fork's setup and the base's checkout are steps the adapter gives, each
// in a type of its own: `planFork` takes only a `ForkSetup`, and
// `refreshBase` only a `BaseCheckout`. A kind whose forks restore from a
// state of their own (a folder's) has no base snapshot, and its accepted
// work no checkout.

import type {
  BaseMerge,
  ConflictChoice,
  CopyRefusal,
  EntryId,
  ForkStart,
  LaneBase,
  PointId,
  ReadyCopy,
  SnapshotId,
  ThreadId,
  ValueWrite,
  WriterId,
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
  /**
   * The checkout of `points`, on a fresh disk or on the base before; null
   * for a kind with no base snapshot, whose forks restore from `ForkSetup.from`.
   */
  readonly checkout: ((fresh: boolean) => BaseCheckout) | null
}

declare const forkSetupBrand: unique symbol
/** What makes a cloned disk a fork: the snapshot it is restored from, then lane steps. */
export interface ForkSetup {
  /**
   * The snapshot the fork's disk is restored from; null for the fork
   * source's own (`ForkSource.snapshot`: a turn's, or the base).
   */
  readonly from: SnapshotId | null
  readonly steps: readonly LaneStep[]
  readonly [forkSetupBrand]: true
}
/** Only an adapter makes one, from its own fork steps. */
export const forkSetup = (
  from: SnapshotId | null,
  steps: readonly LaneStep[],
): ForkSetup => ({ from, steps }) as ForkSetup

declare const startRecordsBrand: unique symbol
/** A lane's start as its history records it: written only with its fork's end. */
export interface StartRecords {
  readonly writes: readonly ValueWrite<"session">[]
  readonly [startRecordsBrand]: true
}
/** Only an adapter makes one, from its own records of the start. */
export const recordedStart = (
  writes: readonly ValueWrite<"session">[],
): StartRecords => ({ writes }) as StartRecords

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
      /** The titles of the commits that came in (`MergePlan.came`), without the accepted thread commits joined. */
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
       * first; `theirs` without the accepted thread commits joined.
       */
      readonly ours: readonly TouchedRevision[]
      readonly theirs: readonly TouchedRevision[]
    }
  /** The merge cannot be made, and nothing was: why, worded for a person and the agent. */
  | { readonly kind: "refused"; readonly reason: string }
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

/**
 * Who closes a conflict: the agent, in its run, whose container is up; or a
 * person, only while the thread is idle (`planResolveCommand`), its
 * container perhaps stopped.
 */
export type Resolver =
  | { readonly kind: "agent" }
  | { readonly kind: "person"; readonly by: WriterId }

/**
 * What `resolve` did: the path closed, or why not: no open conflict there,
 * or a history whose conflicts are markers in the file (jj's).
 */
export type Resolved =
  | { readonly kind: "resolved" }
  | { readonly kind: "refused"; readonly why: "no-conflict" | "markers" }

/** A lane's history, on its queue. */
export interface LaneHistory {
  /**
   * A fork's setup on a disk cloned from its fork point, planned from `start`
   * alone with no I/O: the fork runs its steps.
   */
  forkSteps(start: ForkStart): ForkSetup
  /**
   * The records of where the lane began, once its fork made its disk
   * (`forkSteps`' setup run) and its container runs. It writes none of them:
   * its caller writes them with the fork's end, in one write (`StartRecords`).
   */
  startRecords(start: ForkStart): Promise<StartRecords>
  /**
   * The snapshot of the lane's newest state, which the project keeps off the
   * lane's disk; null when its history keeps none, as jj's, on its disk.
   */
  keptSnapshot(): Promise<SnapshotId | null>
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
  /** A conflicted `path` closed with `choose`'s version in the lane, by `who`. */
  resolve(
    path: string,
    choose: ConflictChoice,
    who: Resolver,
  ): Promise<Resolved>
  /**
   * What a disk restored from a snapshot needs before its first command:
   * at each container's start, whatever made its disk.
   */
  afterRestore(): Promise<void>
}
