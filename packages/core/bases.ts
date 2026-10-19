// core/bases — where a lane's work starts: a thread's base or its parent, the
// states of the project's history, a lane's base read from it, whether a
// lane's copy may take a merge, and where a fork or a catch-up starts.

import type { ThreadId } from "./ids.ts"
import type { ThreadName } from "./thread-names.ts"

/**
 * Where a thread's lane starts and is brought up to date from: accepted work,
 * or a WIP bookmark you chose at its first message.
 */
export type ThreadBase =
  | { readonly kind: "accepted" }
  | { readonly kind: "unfinished"; readonly bookmark: string }

/** The thread a lane's copy was cloned from, by its lane and its name. */
export interface ParentThread {
  readonly kind: "parent"
  readonly lane: ThreadId
  readonly name: ThreadName
}

/**
 * Where a lane's working copy sits against its bookmark, read before a catch-up
 * merges: `@`'s parents, the lane's bookmark, and whether `@`'s one parent
 * descends from it (the agent's own commit).
 */
export interface CopyFacts {
  readonly parents: readonly CommitId[]
  readonly bookmark: CommitId | null
  readonly descends: boolean
}

declare const readyCopyBrand: unique symbol
/**
 * A copy found ready to take a merge (`planCopyReady`, its one maker): a
 * merge takes one, so none merges a copy nobody checked.
 */
export type ReadyCopy = CopyFacts & { readonly [readyCopyBrand]: true }

/** Why a copy cannot take a merge: off its line, or with no bookmark. */
export type CopyRefusal = "off-line" | "no-bookmark"

/**
 * Whether the lane's copy may take a merge: `@` on the thread's
 * own line, its one parent the lane's bookmark or the agent's own commit on
 * it (`planTurnCommit`'s rule). Otherwise the merge would land beside where
 * the agent works, as while a split's stack is the working copy. A repo
 * with no bookmark of the lane's has no line to be on, and is refused as
 * that, not as off it: a split is not the cause. Conflicts do not
 * refuse it: catching up is how a conflict the copy came with is settled.
 */
export const planCopyReady = (copy: CopyFacts): ReadyCopy | CopyRefusal => {
  if (copy.bookmark === null) return "no-bookmark"
  const [parent, ...more] = copy.parents
  return parent !== undefined &&
    more.length === 0 &&
    (parent === copy.bookmark || copy.descends)
    ? (copy as ReadyCopy)
    : "off-line"
}

/**
 * A folder lane's copy, always ready: it has no stack, so nothing moves it
 * off its line. Only the folder adapter calls it; any caller could make a
 * `ReadyCopy` with it, the trade-off `planCopyReady` already accepts.
 */
export const folderCopyReady = (): ReadyCopy => {
  const none: CopyFacts = { parents: [], bookmark: null, descends: false }
  return none as ReadyCopy
}

/** What a catch-up merges from: the thread's base, or the thread it branched from. */
export type LatestFrom = ThreadBase | ParentThread

/**
 * A lane's base, read from its history: the shape once, for the states a
 * port carries (`LaneBase`) and for the commits jj reads in your repo
 * (`LaneBaseOf<CommitId>`).
 */
interface LaneBaseOf<P extends string> {
  readonly base: ThreadBase
  /**
   * Where the lane's own work begins: the state of accepted work its base
   * names, or the WIP's copy; for a lane with no `Pinetrie-Base`, the newest
   * state of accepted work in its history.
   */
  readonly start: P
  /**
   * The state of yours the lane holds whole since its base: the one its
   * `Pinetrie-Base` names (the WIP's, for a WIP, never the copy); for a lane
   * with none, `start`.
   */
  readonly source: P
}

/** A lane's base as the ports carry it. */
export type LaneBase = LaneBaseOf<PointId>
/** A lane's base as jj reads it in your repo: commits. */
export type CommitBase = LaneBaseOf<CommitId>

declare const commitIdBrand: unique symbol
/**
 * A jj commit id, full hex. A revision a lane builds on is immutable, so its
 * commit id never changes: never a change id, which names a commit's latest
 * rewrite.
 */
export type CommitId = string & { readonly [commitIdBrand]: true }
export const commitId = (id: string): CommitId => id as CommitId

declare const pointIdBrand: unique symbol
/**
 * A state in the project's history, opaque: a jj commit's id, or a folder's
 * snapshot's, as the lane it is read in keeps (`LaneRecord.history`). Stored
 * as the bare string. Only a lane proven jj reads one as a commit
 * (`@pinetrie/jj`'s `commitFromPoint`).
 */
export type PointId = string & { readonly [pointIdBrand]: true }
/** A stored string as a point: for decoders. */
export const pointId = (id: string): PointId => id as PointId
/** A jj commit as the point it is: every commit is a state of the history. */
export const pointFromCommit = (c: CommitId): PointId => pointId(c)

/**
 * What a fork starts on: a state a lane recorded (a branch below agent work),
 * accepted work's state, or a copy of a WIP bookmark made on the accepted
 * commit under it, so the lane freezes nothing of yours.
 */
export type ForkStart =
  | { readonly kind: "recorded"; readonly points: readonly PointId[] }
  | { readonly kind: "accepted"; readonly point: PointId }
  | {
      readonly kind: "unfinished"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** The accepted commit under the WIP: the copy's parent. */
      readonly under: CommitId
    }

/**
 * What bringing a thread up to date merges into its lane: accepted work's
 * state, or a fresh copy of a WIP; or the newest state of the thread it
 * branched from.
 */
export type BaseMerge =
  | {
      readonly kind: "accepted"
      readonly point: PointId
      /** The thread moves to accepted work: with nothing to merge, a commit still names it. */
      readonly mark: boolean
    }
  | {
      readonly kind: "unfinished"
      readonly bookmark: string
      /** The WIP's commit: whose files the copy holds. */
      readonly commit: CommitId
      /** Accepted work commit under the WIP: where the commits that came in start. */
      readonly under: CommitId
      /**
       * The lane's previous copy (`LaneBase.start`): the new copy's parent,
       * so conflicts the lane already resolved do not come back.
       */
      readonly on: PointId
    }
  | (ParentThread & {
      /** The parent's newest state (`ParentNow.newest`). */
      readonly point: PointId
      /** The parent's state the lane last caught up with: where what came in starts. */
      readonly upToDateWith: PointId
    })
