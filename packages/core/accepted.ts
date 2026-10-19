// core/accepted — a jj project's accepted work and a thread's base, as
// recorded, and what a catch-up would change. jj builds these records and
// rules decodes them; the union of each with its folder half is rules'.

import type { CommitId, ThreadBase } from "./bases.ts"
import type { ThreadId } from "./ids.ts"
import type { FilesTouched } from "./proposed.ts"

/**
 * Accepted work in your repo. The repo is the truth; the host rewrites this
 * whenever your repo's operation head moves.
 */
export interface JjAcceptedRecord {
  readonly kind: "jj"
  /** Accepted work's bookmark, and the prefix that makes a bookmark a WIP. */
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  /** The bookmark publishing moves forward to accepted work. */
  readonly publish: string
  /** Accepted work's commit; null before it is set up. */
  readonly commit: CommitId | null
  /**
   * Your repo's `immutable_heads()` now (null: jj's builtin), and what
   * setting up accepted work writes. Equal once it is written.
   */
  readonly heads: { readonly current: string | null; readonly proposed: string }
  /**
   * Your repo's `revsets.log` now (null: jj's default), and what setting up
   * accepted work writes: the proposed changes added, since an immutable head
   * is out of jj's default log.
   */
  readonly log: { readonly current: string | null; readonly proposed: string }
  /** The WIP bookmarks a thread may start from, newest first. */
  readonly wips: readonly {
    readonly bookmark: string
    readonly commit: CommitId
    /** Line commits it lacks: how far it is behind accepted work. */
    readonly behind: number
    /** Its commits not on accepted work: what lands with it. */
    readonly ahead: number
  }[]
  /**
   * The publish bookmark against accepted work: its commit (null when the repo
   * has none), accepted commits it lacks (`behind`: what publishing moves it
   * over) and its commits accepted work lacks (`ahead`: publishing is a
   * fast-forward only at 0). Both 0 before accepted work is set up.
   */
  readonly published: {
    readonly commit: CommitId | null
    readonly behind: number
    readonly ahead: number
  }
  /**
   * Your `@-` against accepted work: accepted commits it lacks (`behind`), and
   * your commits below `@` accepted work lacks (`ahead`, `::@- ~ ::<accepted>`:
   * what a publish accepts). `getLatest` is what catching the working copy up
   * would do: how many files change, those that conflict, and your other heads
   * that move with `@`; null when nothing is behind, or `@` shares no commit
   * with accepted work. `conflicts` are your conflicted commits above accepted
   * work, `@` included, and the conflicted files in `@`.
   */
  readonly workingCopy: {
    readonly behind: number
    readonly ahead: number
    readonly getLatest: {
      readonly changes: number
      readonly conflicts: readonly string[]
      readonly heads: number
    } | null
    readonly conflicts: {
      readonly commits: number
      readonly files: readonly string[]
    }
  }
  /**
   * `publish.catchUp`: whether a publish catches the working copy up and
   * accepts your commits below `@` before moving the publish bookmark.
   */
  readonly publishCatchesUp: boolean
}

/**
 * A jj lane's base. `start` is the commit the lane's newest `Pinetrie-Base`
 * trailer names, or accepted commit it forked from when it has none.
 */
export interface JjBaseRecord {
  readonly kind: "jj"
  readonly lane: ThreadId
  readonly base: ThreadBase
  readonly start: CommitId
  /** A WIP base: on accepted work now (landed), gone without landing, or neither. */
  readonly state: "ok" | "landed" | "gone"
  /**
   * What catching up would change, read at the lane's tip and the base's commit
   * then; null when the base had not moved, or jj could not say. A reader whose
   * base has moved since reads it as unknown.
   */
  readonly getLatest: GetLatestRead | null
  /**
   * Accepted thread commits of this thread on accepted work, above its base,
   * that name no source (`untracedLanes`): nothing is proposed until it catches
   * up past them.
   */
  readonly untraced: readonly CommitId[]
  /**
   * Whether the lane's work since its start changes any file: `unknown` for an
   * untraced start, or one jj could not diff. A thread is told its base has new
   * work only with `some`, and caught up quietly only with `none`.
   */
  readonly work: FilesTouched
}

/** What catching up would change in a lane (`getLatestFiles`), and what it was read at. */
export interface GetLatestRead {
  readonly tip: CommitId
  /** The base's commit: accepted work's, or the WIP's. */
  readonly to: CommitId
  readonly files: readonly string[]
}
