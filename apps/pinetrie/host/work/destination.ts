// host/work/destination — accepted work and proposed changes as any kind of
// project has them: the port lane work and the host reach your accepted work
// through. Its adapter is chosen once (`host/project.ts`); lane work never
// learns which.

import type {
  AcceptedAction,
  CommitId,
  EntryId,
  ErrCode,
  JjBaseRecord,
  LaneBase,
  LaneRecord,
  PointId,
  ProposedChangesFact,
  ProposedChangesSeen,
  RevisionRecord,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { FileAt, ReadSite } from "@pinetrie/lanes"
import {
  readAccepted,
  readLaneRecords,
  readProposedByLane,
  readRecords,
  readRevisions,
} from "@pinetrie/reads"
import {
  type ArchiveTeardown,
  CONFLICT,
  type ForkBegin,
  type ReviewAnswer,
  type ReviewAsk,
  type ReviewFacts,
} from "@pinetrie/rules"
import type { LeaseBasics } from "../basics.ts"

/** What a catch-up decides its base's update from (`planUpdateFrom`). */
export interface BaseNow {
  /** What became of a WIP base; "ok" for accepted work. */
  readonly state: JjBaseRecord["state"]
  /** Accepted work's state; null before it is set up. */
  readonly acceptedPoint: PointId | null
  /** For a WIP base: its commit now, and accepted work's commit under it. */
  readonly wipNow: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}

/** What any kind of project does with a lane's proposed changes. */
export interface ProposedChangesActs {
  /** A run on `lane` ended: refresh its proposed changes, then describe it if it is still a WIP. */
  runEnded(lane: ThreadId): void
  /**
   * An action on proposed changes other than a split; an acceptance names its
   * destination, null for the default, and what it was shown. Carried out, it
   * answers with its fact, which the thread is told.
   */
  act(
    lane: ThreadId,
    action: "accept" | "squash" | "describe" | "refresh",
    by: WriterId,
    to?: string | null,
    seen?: ProposedChangesSeen | null,
  ): Promise<
    | {
        readonly kind: "refused"
        readonly code: ErrCode
        /** The path it names, for a folder accept's refusal. */
        readonly path?: string
      }
    | { readonly kind: "done"; readonly fact: ProposedChangesFact }
  >
  /** A review, a diff or a file's bytes a page asked for, of a span `planReviewRead` finds. */
  read(ask: ReviewAsk): Promise<ReviewAnswer>
}

/** A setup's or a publish's answer: null when carried out, else why not, worded. */
export type AcceptedAnswer = {
  readonly code: ErrCode
  readonly message: string
} | null

/** A restore's answer: done, or refused with the path it names, if any. */
export type RestoreAnswer =
  | {
      readonly kind: "refused"
      readonly code: ErrCode
      readonly path?: string
    }
  | { readonly kind: "done" }

/**
 * Accepted work's own acts, by the project's kind: a jj project's setup
 * and publish, a folder project's restore. Neither kind carries the
 * other's: the command handler refuses a mismatch.
 */
export type AcceptedActs =
  | {
      readonly kind: "jj"
      act(action: AcceptedAction): Promise<AcceptedAnswer>
    }
  | {
      readonly kind: "folder"
      /** `of`'s content written into the project's folder, as accepted work's newest was `seen`. */
      restore(of: PointId, seen: PointId, by: WriterId): Promise<RestoreAnswer>
    }

export interface Destination {
  /** `path` at `site`, read at the head the destination last observed. */
  fileAt(site: ReadSite, path: string): Promise<FileAt>
  /** Where a new lane begins for `base` (a WIP's name, null for accepted work), or why it cannot. */
  begin(base: string | null): Promise<ForkBegin | ErrCode>
  /**
   * What `lane`, on `base`, would catch up with, read at once: refused
   * (thrown) for a lane whose history is not the destination's kind.
   */
  baseNow(lane: LaneRecord, base: LaneBase | null): Promise<BaseNow>
  /** An archive's or a restore's lanes: their history set or dropped, their proposed changes followed. */
  lanesMoved(refs: ArchiveTeardown["refs"]): Promise<void>
  readonly proposed: ProposedChangesActs
  readonly accepted: AcceptedActs
  /** Settles when nothing is queued on accepted work. */
  quiet(): Promise<void>
  /** Shutdown: nothing more is queued. */
  close(): void
}

/**
 * What a review may read is found in (`planReviewRead`): every proposed
 * changes, the revisions of the roots of their lanes, each leased while
 * it is read, since a range is named by two states of one lane; accepted
 * work's record, whose kept states a folder project's history reviews; and
 * the open conflicts, whose sides a lane's pane reviews.
 */
export async function reviewReadFacts(
  basics: Pick<LeaseBasics, "session" | "leases">,
): Promise<ReviewFacts> {
  const proposedByLane = readProposedByLane(basics.session)
  const lanes = readLaneRecords(basics.session)
  const roots = new Set(
    [...proposedByLane.keys()].flatMap(lane => lanes.get(lane)?.root ?? []),
  )
  const revisions = new Map<EntryId, RevisionRecord>()
  for (const root of [...roots].sort()) {
    await using held = basics.leases.root(root)
    for (const [entry, r] of readRevisions(await held.ready))
      revisions.set(entry, r)
  }
  return {
    proposedByLane,
    revisions,
    accepted: readAccepted(basics.session),
    conflicts: [...readRecords(basics.session, CONFLICT).values()],
  }
}
