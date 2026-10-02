// host/offers — each lane's offer in your repo, as the host keeps it
// (ADR-0038, ADR-0039).
//
// Every operation runs on `OfferState`'s one queue for your repo, so no two
// interleave: a trigger gathers (`offerNow`: where the offer sits and
// starts, and the offer as your repo holds it), plans (`planRefresh`, then
// `planOfferEffects`), and executes planned jj steps, then writes the
// `pineta.offer` record, the page's cache, from the repo. The host decides
// nothing from a record (ADR-0060). Triggers: a lane's fetch, a run's end, an offer action, and your
// own jj operations (`watch.ts`). The queue also carries the reads a page asks
// for (`read`, ADR-0047): a jj read can write (S57).

import type {
  CommitId,
  ErrCode,
  LaneName,
  LineAction,
  WriterId,
} from "@pineta/core"
import { fileDiff, type LineConfig, revisionRead } from "@pineta/lanes"
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
import { createLine } from "./line.ts"
import { createRefresh } from "./refresh.ts"
import { stackEnded, stackSpan } from "./stack.ts"
import { createOfferState } from "./state.ts"
import { startWatch } from "./watch.ts"

export interface Offers {
  /** Something changed for `lane`: its fetch finished, or you ran jj. */
  touch(lane: LaneName): void
  /** A run on `lane` ended: refresh its offer, then describe it if it changed. */
  runEnded(lane: LaneName): void
  /** An offer action other than a split; a take names its destination, null for the default. */
  act(
    lane: LaneName,
    action: "take" | "squash" | "describe" | "refresh",
    by: WriterId,
    to?: string | null,
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
  /** A `line` command (ADR-0060): null when carried out, else why not. */
  line(action: LineAction): Promise<ErrCode | null>
  /** Settles when no offer work is queued or running. */
  quiet(): Promise<void>
  /**
   * Shutdown: stop polling your repo, and refuse every offer step from now
   * on. `quiet` still waits for the steps already queued.
   */
  stop(): void
}

export function startOffers(input: {
  readonly root: string
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /** Whether this host takes `line` commands: it admits no one else. */
  readonly lineCommands: boolean
  readonly basics: Basics
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take or a land: the base snapshot follows the line. */
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

  const line = createLine(state)
  const watch = startWatch(state, {
    line: () => void line.refresh().catch(failed(basics, "reading the line")),
    touch,
  })

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
    act: (lane, action, by, to = null) =>
      act(state, refresh, lane, action, by, to),
    line: action => line.act(action),
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
    stop() {
      watch.close()
      serial.close()
    },
  }
}
