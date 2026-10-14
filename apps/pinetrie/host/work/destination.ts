// host/work/destination — accepted work and offers as any kind of project
// has them: the port lane work and the host reach your accepted work through.
// Its adapter is chosen once (`host/project.ts`); lane work never learns
// which.

import type {
  AcceptedAction,
  BaseRecord,
  CommitId,
  ErrCode,
  LaneBase,
  OfferFact,
  OfferSeen,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { FileAt, Point } from "@pinetrie/lanes"
import type {
  ArchiveTeardown,
  ForkBegin,
  OfferAnswer,
  OfferAsk,
} from "@pinetrie/rules"

/** What a catch-up decides its base's update from (`planUpdateFrom`). */
export interface BaseNow {
  /** What became of a WIP base; "ok" for accepted work. */
  readonly state: BaseRecord["state"]
  /** Accepted work's commit; null before it is set up. */
  readonly acceptedCommit: CommitId | null
  /** For a WIP base: its commit now, and accepted work's commit under it. */
  readonly wipNow: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}

/** What any kind of project does with a lane's offer. */
export interface OfferActs {
  /** A run on `lane` ended: refresh its offer, then describe it if it is still a WIP. */
  runEnded(lane: ThreadId): void
  /**
   * An offer action other than a split; an acceptance names its destination,
   * null for the default, and what it was shown. Carried out, it answers with
   * its fact, which the thread is told.
   */
  act(
    lane: ThreadId,
    action: "accept" | "squash" | "describe" | "refresh",
    by: WriterId,
    to?: string | null,
    seen?: OfferSeen | null,
  ): Promise<
    | { readonly kind: "refused"; readonly code: ErrCode }
    | { readonly kind: "done"; readonly fact: OfferFact }
  >
  /** A review or a diff a page asked for, of a commit an open offer holds. */
  read(ask: OfferAsk): Promise<OfferAnswer>
}

/** A setup's or a publish's answer: null when carried out, else why not, worded. */
export type AcceptedAnswer = {
  readonly code: ErrCode
  readonly message: string
} | null

/** Accepted work's own acts: a setup or a publish. */
export interface AcceptedActs {
  act(action: AcceptedAction): Promise<AcceptedAnswer>
}

export interface Destination {
  /** `path` at `point`, read at the head the destination last observed. */
  fileAt(point: Point, path: string): Promise<FileAt>
  /** Where a new lane begins for `base` (a WIP's name, null for accepted work), or why it cannot. */
  begin(base: string | null): Promise<ForkBegin | ErrCode>
  /** What a lane on `base` would catch up with, read at once. */
  baseNow(base: LaneBase | null): Promise<BaseNow>
  /** An archive's or a restore's lanes: their history set or dropped, their offers followed. */
  lanesMoved(refs: ArchiveTeardown["refs"]): Promise<void>
  readonly offers: OfferActs
  readonly accepted: AcceptedActs
  /** Settles when nothing is queued on accepted work. */
  quiet(): Promise<void>
  /** Shutdown: nothing more is queued. */
  close(): void
}
