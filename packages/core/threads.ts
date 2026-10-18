// core/threads — a thread as the host records it: how it began (a root, a
// spin-off, a branch or a copy), and the proposal a branch was opened from.

import type {
  CanvasId,
  EntryId,
  RootId,
  TextCardId,
  ThreadId,
  WriterId,
} from "./ids.ts"
import type { NonEmpty } from "./proposed.ts"

/**
 * A thread as the host records it, keyed by its id in the session
 * (`pinetrie.thread`). Its first entry and its end are the tree's: every entry
 * names its thread (`EntryLike.thread`).
 */
export interface ThreadRecord {
  readonly thread: ThreadId
  readonly root: RootId
  /** Who started it. */
  readonly by: WriterId
  /** When, in ms since the epoch. */
  readonly createdAt: number
  readonly origin: ThreadOrigin
}

/**
 * How a thread began: a root's first thread, a root's first thread spun from a
 * text card, or a fork at `at`, a branch or a copy. A fork's source is the
 * thread its entry is in, so it is not stored. Before its first send a thread's
 * column ends at its fork, and its first send branches there.
 */
export type ThreadOrigin =
  | { readonly kind: "root" }
  /**
   * Spun from `card`, which went to its spinner's trash: the undo key
   * lifts the thread back into it while the thread holds that first
   * message alone (`planLiftRoot`).
   */
  | { readonly kind: "spun"; readonly card: TextCardId }
  | ThreadFork

/**
 * A thread forked at an entry: a branch, or a copy, whose fork row says so. A
 * branch opened from an agent's proposal names it, and only a branch can.
 */
export type ThreadFork =
  | {
      readonly kind: "fork"
      readonly at: EntryId
      readonly how: "branch"
      readonly proposal?: ProposalBranch
    }
  | { readonly kind: "fork"; readonly at: EntryId; readonly how: "copy" }

/**
 * A branch's place in the proposal it was opened from: the entry of the
 * `propose_branches` result, and its row there. The thread records naming a
 * proposal are what make it spent (`proposalState`).
 */
export interface ProposalBranch {
  readonly entry: EntryId
  readonly row: number
}

/** One branch an agent proposes: a short title, and the brief its agent starts from. */
export interface ProposedBranch {
  readonly title: string
  readonly brief: string
}

/** What a `propose_branches` call proposes, in its order: at least one branch. */
export interface Proposal {
  readonly branches: NonEmpty<ProposedBranch>
}

/** A row of a proposal pressed: the thread its branch opens as, minted by the presser's page. */
export interface OpenedRow {
  readonly thread: ThreadId
  readonly row: number
}

/** A row pressed Start: its brief as the presser left it, which the host asks the agent. */
export interface StartedRow extends OpenedRow {
  readonly brief: string
}

/**
 * A press on a proposal: Open opens its rows unsent, and carries no text;
 * Start opens them and sends each brief.
 */
export type BranchOut =
  | {
      readonly kind: "branch-out"
      readonly how: "open"
      readonly root: RootId
      /** The proposing thread's canvas, where the branches land. */
      readonly canvas: CanvasId
      readonly proposal: EntryId
      readonly branches: NonEmpty<OpenedRow>
    }
  | {
      readonly kind: "branch-out"
      readonly how: "start"
      readonly root: RootId
      readonly canvas: CanvasId
      readonly proposal: EntryId
      readonly branches: NonEmpty<StartedRow>
    }

/** A root's first thread. */
export const ROOT_ORIGIN: ThreadOrigin = { kind: "root" }

/** The entry a thread forks at, where its first send branches; null for a root's first thread, spun or not. */
export const forkEntry = (origin: ThreadOrigin): EntryId | null =>
  origin.kind === "fork" ? origin.at : null
