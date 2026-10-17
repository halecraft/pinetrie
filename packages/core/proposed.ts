// core/proposed — a thread's proposed changes and accepted work in your repo:
// the facts `@pinetrie/jj` reads, and the decisions it carries out, which
// `@pinetrie/rules` returns from those facts.

import type {
  CommitBase,
  CommitId,
  ERR,
  ErrCode,
  JjAcceptedRecord,
  JjBaseRecord,
  JjProposedChangesRecord,
  PointId,
  ThreadName,
} from "./index.ts"

/** Where proposed changes are accepted into: accepted work's bookmark, or a folder project's accepted work. */
export type AcceptsInto =
  | { readonly kind: "bookmark"; readonly bookmark: string }
  | { readonly kind: "folder" }

/**
 * A revision since the host's version of it (`readProposedChanges` in
 * `@pinetrie/jj` reads it, `revisionEdited` in `@pinetrie/rules` decides from
 * it): whether the host has a version of it, and whether one not the host's
 * changed it since. Read from the repo (the host's remote bookmark, else the
 * evolog), never from a record the host kept, which can be lost after its jj
 * steps landed.
 */
export interface RevisionFacts {
  readonly reached: boolean
  readonly yoursChanged: boolean
}

/** One revision of proposed changes, as your repo holds it now. */
export interface ProposedRevision {
  readonly commit: CommitId
  /** What jj steps on it name. */
  readonly changeId: string
  readonly since: RevisionFacts
}

/** Proposed changes' ledger, as its top's message carries it (`proposedLedger`). */
export interface ProposedLedger {
  /** The lane tip it holds (`Pinetrie-Source`). */
  readonly source: CommitId
  /** Where it starts (`Pinetrie-Start`). */
  readonly start: readonly CommitId[]
}

/**
 * What an acceptance was shown, and whether it conflicted: a jj project's
 * proposed changes' ledger, or a folder project's two states. An
 * acceptance whose proposed changes now bring other work, or newly
 * conflict, is refused (`NOT_AS_SHOWN`).
 */
export type ProposedChangesSeen =
  | {
      readonly kind: "jj"
      readonly ledger: ProposedLedger | null
      readonly conflicted: boolean
    }
  | {
      readonly kind: "folder"
      readonly start: PointId
      readonly tip: PointId
      readonly conflicted: boolean
    }

/**
 * Proposed changes as your repo holds it now (`readProposedChanges` in
 * `@pinetrie/jj`): all the host decides proposed changes from. Facts only; what
 * they mean is decided in `@pinetrie/rules` (`planRefresh`, `isProposedEdited`,
 * `isProposedMoved`) and `isWipLine` (`trailers.ts`). Divergent proposed
 * changes are only its change ids: the repair needs nothing more, and every
 * other read would name one of two commits.
 */
export type ProposedChangesInRepo =
  | {
      readonly kind: "present"
      /** The bookmark it was found under (`proposedBookmark`). */
      readonly bookmark: string
      /**
       * Its top is the host's version of it, `<bookmark>@pinetrie-host`: no
       * step since the host's last one moved it.
       */
      readonly marked: boolean
      /** Bottom first. */
      readonly revisions: readonly ProposedRevision[]
      /** Each revision's parent is the one below it: no commit of yours between. */
      readonly chained: boolean
      readonly ledger: ProposedLedger | null
      /** The top's first line. */
      readonly firstLine: string
      /** The bottom's parent is an ancestor of the target. */
      readonly placed: boolean
      /** The bottom's parents are exactly the target. */
      readonly onTarget: boolean
      readonly files: readonly string[]
      /** Files conflicting in its top: with the work under it. */
      readonly conflicts: readonly string[]
      /** Files conflicted where its ledger says it starts, read only when it conflicts. */
      readonly startConflicts: readonly string[]
    }
  | { readonly kind: "divergent"; readonly changeIds: readonly string[] }

/**
 * Whether a lane's work since its start changes any file, as far as jj can
 * tell: `unknown` when it cannot, which never builds proposed changes.
 */
export type FilesTouched = "none" | "some" | "unknown"

/** A list with at least one element. */
export type NonEmpty<T> = readonly [T, ...T[]]

/**
 * `xs` as `NonEmpty`, or null when it is empty. Its elements are never
 * `undefined`, which marks the empty list.
 */
export const nonEmpty = <T extends NonNullable<unknown>>(
  xs: readonly T[],
): NonEmpty<T> | null => {
  const [first, ...rest] = xs
  return first === undefined ? null : [first, ...rest]
}

/**
 * Where a lane's proposed changes start, or `untraced`: an accepted thread
 * commit of this lane above its base names no source (`untracedLanes`), so no
 * start can leave out what it brought, and nothing is proposed until the lane
 * catches up past it.
 */
export type StartRead =
  | { readonly kind: "known"; readonly start: NonEmpty<CommitId> }
  | {
      readonly kind: "untraced"
      readonly acceptedThreadCommits: readonly CommitId[]
    }

/** One revision of proposed changes: the lane commit whose files it has, and its message. */
export interface ProposedSource {
  readonly commit: CommitId
  readonly description: string
}

/** Each revision's change id, bottom first: what jj steps on it name. */
export const revisionChangeIds = (
  proposed: ProposedChangesInRepo,
): readonly string[] =>
  proposed.kind === "divergent"
    ? proposed.changeIds
    : proposed.revisions.map(r => r.changeId)

/** Proposed changes as your repo holds it, not divergent. */
export type ProposedChangesNow = Extract<
  ProposedChangesInRepo,
  { readonly kind: "present" }
>

// ── where proposed changes sit (the gathers in `@pinetrie/jj`)
// ───────────────────

/** A place proposed changes can be built on: a target, and a known start. */
export interface Placed {
  readonly kind: "placed"
  /** The lane's tip in your repo. */
  readonly tip: CommitId
  readonly base: CommitBase
  /** A WIP base's state (`wipState`, `@pinetrie/jj`); "ok" for accepted work. */
  readonly state: "ok" | "landed"
  /** Where the proposed changes sit: accepted work's commit, or the WIP bookmark's. */
  readonly target: CommitId
  /** Where it starts (`startOfProposed`). */
  readonly start: readonly CommitId[]
}

/**
 * Where a lane's proposed changes sit and start, read from your repo now,
 * decided once by the gather.
 */
export type ProposedChangesPlace =
  /** A WIP gone without landing: nothing sits anywhere, and nothing moves. */
  | { readonly kind: "gone"; readonly tip: CommitId; readonly base: CommitBase }
  /**
   * An accepted thread commit of the lane names no source: nothing is built
   * here, but proposed changes that are here can be accepted, since an
   * acceptance moves a bookmark and needs no start.
   */
  | {
      readonly kind: "untraced"
      readonly tip: CommitId
      readonly base: CommitBase
      readonly state: "ok" | "landed"
      readonly target: CommitId
    }
  | Placed

/** One step on proposed changes' gather: where the proposed changes sit, and the proposed changes there. */
export interface ProposedChangesGather {
  readonly place: ProposedChangesPlace
  /** Null proposed changes with no name yet: proposed changes are found by its thread's name. */
  readonly name: ThreadName | undefined
  readonly proposed: ProposedChangesInRepo | null
  /**
   * The lane's base record as the repo says it now, what catching up would
   * change and its untraced accepted thread commits with it: the host writes it
   * when it differs from the page's.
   */
  readonly base: JjBaseRecord
}

/** What a refresh decides from (`planRefresh`). */
export type RefreshFacts =
  /** The thread's root is archived: the proposed changes alone, read against accepted work. */
  (
    | {
        readonly kind: "archived"
        readonly proposed: ProposedChangesInRepo | null
      }
    /** An accepted thread commit of the lane names no source. */
    | {
        readonly kind: "untraced"
        readonly proposed: ProposedChangesInRepo | null
      }
    | {
        readonly kind: "placed"
        readonly place: Placed
        /** Whether the lane's work since its start changes any file. */
        readonly work: FilesTouched
        readonly proposed: ProposedChangesInRepo | null
      }
  ) & {
    /**
     * The host's version of the proposed changes are still in your repo with no
     * proposed changes bookmark beside it: you abandoned the proposed changes,
     * or deleted its bookmark.
     */
    readonly hostLeft: boolean
  }

/** What only an acceptance reads; the rest is in its gather's place. */
export interface AcceptanceFacts {
  /** The WIP's commits above accepted work; 0 for a lane on accepted work. */
  readonly wipAhead: number
  /**
   * Of accepted work's bookmark and, on a WIP, the WIP's, those at or below the
   * proposed changes' bottom's parent: a move to one is forward.
   */
  readonly below: ReadonlySet<string>
}

/** A split's stack, as it is in your repo after its run. */
export interface StackFacts {
  /** Bottom first, each with its message. */
  readonly revisions: readonly ProposedSource[]
  /** The files its top differs from the lane's tip in. */
  readonly differing: readonly string[]
}

// ── what `@pinetrie/rules` decides, and `@pinetrie/jj` carries out ──────────

/**
 * Proposed changes built anew at `place` from `sources`, after abandoning the
 * revisions of `changeIds`: a build (none), a squash or refresh, or a split's
 * stack.
 */
export interface Rebuild {
  /** The thread's name: the proposed changes' bookmark and its messages' trailer. */
  readonly name: ThreadName
  readonly place: Placed
  readonly changeIds: readonly string[]
  readonly sources: readonly ProposedSource[]
}

/** What a trigger does to a lane's proposed changes (`planRefresh`). */
export type RefreshDecision =
  /**
   * No proposed changes, and none to build: remove a record left from one, and
   * with `hostLeft` the host's version left in your repo.
   */
  | { readonly kind: "forget"; readonly hostLeft: boolean }
  /** Abandon it and remove its record: archived, untraced, reached, or its work changes no file. */
  | { readonly kind: "withdraw"; readonly proposed: ProposedChangesInRepo }
  /** No proposed changes: build one from the lane's tip, from work known to change a file and a known start. */
  | { readonly kind: "build"; readonly place: Placed }
  /** The lane, or where it starts, moved under single proposed changes you did not edit: rebuild it in place. */
  | {
      readonly kind: "rebuild"
      readonly place: Placed
      readonly proposed: ProposedChangesNow
    }
  /** Only the target moved: rebase it there. */
  | {
      readonly kind: "refresh"
      readonly place: Placed
      readonly proposed: ProposedChangesNow
    }
  /** Nothing runs, and the record is written from the proposed changes: unchanged, a stack the lane moved past, or yours. */
  | { readonly kind: "none" | "stale" | "leave"; readonly place: Placed }
  /**
   * Unchanged and the host's, but its host version lags: a host step stopped
   * before its mark, or the proposed changes were built before proposed changes
   * had one. The host's version is moved to it.
   */
  | { readonly kind: "mark"; readonly place: Placed }
  /** Your edit and the host's crossed: keep yours. */
  | {
      readonly kind: "repair"
      readonly place: Placed
      readonly changeIds: readonly string[]
    }
  /**
   * Untraced, and divergent or yours: nothing runs, and the record stays as it
   * is: the host does not act on what it cannot tell, so such proposed changes
   * are neither repaired nor recorded until the lane catches up past the
   * accepted thread commit.
   */
  | { readonly kind: "untouched" }

/** An acceptance (`planAcceptance`): the bookmark it moves and the revision it moves to, or why not. */
export type AcceptanceDecision =
  | {
      readonly kind: "accept"
      readonly name: ThreadName
      readonly bookmark: string
      readonly destination: string
      /** The proposed changes' top's change id. */
      readonly top: string
      /** Its record, marked accepted. */
      readonly accepted: JjProposedChangesRecord
    }
  | { readonly kind: "refused"; readonly code: ErrCode }

/** The single revision to describe (`planDescribeSettle`), and the ledger its message keeps. */
export interface DescribeDecision {
  readonly name: ThreadName
  readonly place: Placed
  readonly changeId: string
  readonly ledger: ProposedLedger
}

// ── accepted work ─────────────────────────────────────────────────────────────

/**
 * What the host reads of accepted work, each time it looks (`acceptedFacts` in
 * `@pinetrie/jj`): its commit, the WIPs above it and your work against it,
 * as its record holds them, and your repo's `immutable_heads()` and
 * `revsets.log` as jj resolves them (null for jj's own).
 */
export interface AcceptedFacts
  extends Pick<JjAcceptedRecord, "commit" | "wips" | "published" | "yours"> {
  readonly heads: string | null
  readonly log: string | null
}

/**
 * A publish, decided before its first step: on the host's own machine, the
 * working copy catches up with accepted work first (`catchUp`), and your
 * commits below `@` move onto it with the publish bookmark (`accept`).
 */
export interface PublishDecision {
  readonly kind: "publish"
  readonly acceptedBookmark: string
  readonly publish: string
  /** Rebase `@` onto accepted work first, as you. */
  readonly catchUp: boolean
  /** Accepted work moves with the publish bookmark, to your `@-`. */
  readonly accept: boolean
}

/** A setup or publish (`planAcceptedAction`): what it does, or why not. */
export type AcceptedWorkDecision =
  /** Set accepted work up, writing exactly the heads and log its record proposed. */
  | {
      readonly kind: "setup"
      readonly acceptedBookmark: string
      readonly heads: string
      readonly log: string
    }
  | PublishDecision
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * The bookmark move that ends a publish (`planPublishMove`): the publish
 * bookmark to accepted work, or, with `accept`, both to your `@-`.
 */
export interface PublishMove {
  readonly acceptedBookmark: string
  readonly publish: string
  readonly accept: boolean
}

/**
 * A publish's second round (`planPublishFinish`), from accepted work as read
 * after the catch-up: the move, or the catch-up's operation reverted.
 */
export type PublishFinish =
  | ({ readonly kind: "move" } & PublishMove)
  | {
      readonly kind: "undo"
      readonly op: string
      readonly code: typeof ERR.YOURS_CONFLICT | typeof ERR.NOT_FAST_FORWARD
    }
