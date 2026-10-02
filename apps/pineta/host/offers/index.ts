// host/offers — each lane's offer in your repo, as the host keeps it
// (ADR-0038, ADR-0039).
//
// Every operation runs on `OfferState`'s one queue for your repo, so no two
// interleave: a trigger gathers (the lane's tip, where an offer starts, the
// offer's facts), plans (`planRefresh`, then `planOfferEffects`), and
// executes planned jj steps, then writes the `pineta.offer` record when it
// changed. Triggers: a lane's fetch, a run's end, an offer action, and your
// own jj operations (`watch.ts`). The queue also carries the reads a page asks
// for (`read`, ADR-0047): a jj read can write (S57).

import type { CommitId, ErrCode, LaneName, WriterId } from "@pineta/core"
import { fileDiff, revisionRead } from "@pineta/lanes"
import {
  answerDiff,
  answerReview,
  type OfferAnswer,
  type OfferAsk,
  planOfferRead,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readOffers, readRevisions } from "@pineta/reads"
import { type Basics, failed } from "../basics.ts"
import { act } from "./act.ts"
import { describe } from "./describe.ts"
import { createRefresh } from "./refresh.ts"
import { stackEnded, stackSpan } from "./stack.ts"
import { createOfferState } from "./state.ts"
import { startWatch } from "./watch.ts"

export interface Offers {
  /** Something changed for `lane`: its fetch finished, or you ran jj. */
  touch(lane: LaneName): void
  /** A run on `lane` ended: refresh its offer, then describe it if it changed. */
  runEnded(lane: LaneName): void
  /** An offer action other than a split. */
  act(
    lane: LaneName,
    action: "take" | "squash" | "describe" | "refresh",
    by: WriterId,
  ): Promise<ErrCode | null>
  /** Where a split's stack starts and ends: the offer's start and the lane's tip. */
  stackSpan(
    lane: LaneName,
  ): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null>
  /**
   * A split's run ended: its stack, fetched into your repo as `stack`, replaces
   * the offer if it holds exactly the lane tip's files. Returns why not.
   */
  stackEnded(
    lane: LaneName,
    stack: {
      readonly start: readonly CommitId[]
      readonly tip: CommitId
      readonly top: CommitId | null
    },
  ): Promise<string | null>
  /**
   * A review or a diff a page asked for, of a commit an open offer holds now
   * or a range one lane's turns recorded (ADR-0056):
   * gathered, planned (`planOfferRead`) and read on the queue for your repo.
   */
  read(ask: OfferAsk): Promise<OfferAnswer>
  /** Settles when no offer work is queued or running. */
  quiet(): Promise<void>
  close(): void
}

export function startOffers(input: {
  readonly root: string
  readonly basics: Basics
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take: the base snapshot follows your `@-`. */
  readonly taken: () => void
}): Offers {
  const state = createOfferState(input)
  const { serial, basics } = state
  const refresh = createRefresh(state)

  function touch(lane: LaneName): void {
    void serial
      .run(async () => {
        const outcome = await refresh.refresh(lane)
        // Tracked, and logged on failure, by `requestOutside`.
        if (outcome === "built" && !state.running(lane))
          void describe(state, refresh, lane, false)
      })
      .catch(failed(basics, "refreshing its offer", lane))
  }

  const watch = startWatch(state, touch)

  return {
    touch,
    runEnded(lane) {
      void serial
        .track(
          serial
            .run(() => refresh.refresh(lane))
            .then(() => describe(state, refresh, lane, false)),
        )
        .catch(failed(basics, "refreshing its offer", lane))
    },
    act: (lane, action, by) => act(state, refresh, lane, action, by),
    stackSpan: lane => stackSpan(state, lane),
    stackEnded: (lane, stack) => stackEnded(state, refresh, lane, stack),
    read(ask) {
      return serial.run(async () => {
        const read = planOfferRead(
          {
            offers: readOffers(basics.doc),
            revisions: readRevisions(basics.doc),
          },
          ask,
        )
        switch (read.kind) {
          case "refused":
            return read
          case "review":
            return answerReview(await revisionRead(state.ops, read.span))
          case "diff":
            return answerDiff(await fileDiff(state.ops, read.span, read.path))
        }
      })
    },
    quiet: () => serial.idle(),
    close: () => watch.close(),
  }
}
