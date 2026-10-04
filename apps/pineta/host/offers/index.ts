// host/offers — each lane's offer in your repo (ADR-0038, ADR-0039), on the
// owner of your repo (`@pineta/repo`, ADR-0065).
//
// A refresh is upkeep, at most one queued per lane (`later("refresh:…")`):
// gather (`gatherRefresh`), decide (`planRefresh`), translate
// (`offerEffects`), and execute the steps, then write the `pineta.offer`
// record, the page's cache, from the repo (`refresh.ts`). The host decides
// nothing from a record (ADR-0060).
// What marks a lane: a move the owner observes (`planMarks`: the lane's ref
// after a fetch, its offer bookmark, the line, a WIP, your `@`), a run's end,
// and a root archived or restored (`moveLanes`); the line's record
// (`work/line.ts`) is rewritten on the same moves. Commands (an offer action,
// a split's span and end) are owner commands, ahead of every refresh
// waiting. The reads a page asks for (`read`, ADR-0047) are pinned
// reads, which wait on nothing.

import type {
  CommitId,
  ErrCode,
  LaneName,
  OfferSeen,
  WriterId,
} from "@pineta/core"
import type { LineConfig } from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import { readNames, readOffers, readRevisions } from "@pineta/reads"
import {
  fileDiff,
  laneRefSteps,
  type RepoOwner,
  revisionRead,
} from "@pineta/repo"
import {
  answerDiff,
  answerReview,
  isUntaken,
  type OfferAnswer,
  type OfferAsk,
  offerStatus,
  planOfferRead,
  planYourEdits,
} from "@pineta/rules"
import { type Basics, failed } from "../basics.ts"
import type { Line } from "../work/line.ts"
import { act } from "./act.ts"
import { describe } from "./describe.ts"
import { planMarks } from "./marks.ts"
import { createRefresh } from "./refresh.ts"
import { stackEnded, stackSpan } from "./stack.ts"
import { createOfferDeps } from "./state.ts"

export interface Offers {
  /**
   * Set lanes' history in your repo, or delete it with a null commit (a root
   * archived or restored, ADR-0029), then refresh each lane's offer: an
   * archived thread's is withdrawn, a restored one's built again.
   */
  moveLanes(
    updates: readonly {
      readonly lane: LaneName
      readonly commit: CommitId | null
    }[],
  ): Promise<void>
  /** A run on `lane` ended: refresh its offer, then describe it if it is still a WIP. */
  runEnded(lane: LaneName): void
  /**
   * An offer action other than a split; a take names its destination, null
   * for the default, and what it was shown (ADR-0065).
   */
  act(
    lane: LaneName,
    action: "take" | "squash" | "describe" | "refresh",
    by: WriterId,
    to?: string | null,
    seen?: OfferSeen | null,
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
   * gathered, planned (`planOfferRead`), and read pinned to the head the
   * owner last observed, waiting on no write.
   */
  read(ask: OfferAsk): Promise<OfferAnswer>
}

export function startOffers(input: {
  readonly owner: RepoOwner
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  readonly basics: Basics
  readonly agent: () => Agent
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: LaneName) => boolean
  /** After a take: the base snapshot follows the line. */
  readonly taken: () => void
  /** The line's record and commands (`host/work/line.ts`): its record is rewritten when the owner observes the line or your `@` move. */
  readonly lineWork: Line
}): Offers {
  const deps = { ...createOfferDeps(input), describing: new Set<LaneName>() }
  const { owner, basics, records } = deps
  const refresh = createRefresh(deps)

  /**
   * Refresh `lane`'s offer as upkeep, once however often it is marked
   * before it starts; resolves with whether it built.
   */
  function mark(lane: LaneName): Promise<boolean> {
    let built = false
    return owner
      .later(`refresh:${lane}`, async ops => {
        built = (await refresh.refresh(ops, lane)) === "built"
      })
      .then(
        () => built,
        error => {
          failed(basics, "refreshing its offer", lane)(error)
          return false
        },
      )
  }
  /** A refresh, then its description when it built and the lane is idle. */
  const touch = (lane: LaneName) =>
    void mark(lane).then(built => {
      // Tracked, and logged on failure, by `describe`.
      if (built && !deps.running(lane))
        void describe(deps, refresh, lane, false)
    })

  const line = input.lineWork
  const markLine = () =>
    void line.refresh().catch(failed(basics, "reading the line"))
  /**
   * Only `@` moved (jjui, an editor): one shared read rewrites each open
   * record's `yourEdits` and the line's record, with no lane's jj
   * (ADR-0065).
   */
  const markShared = () =>
    void owner
      .later("shared", async ops => {
        const { editing } = await ops.shared()
        await line.record(ops)
        for (const record of planYourEdits(
          readOffers(basics.session).values(),
          editing,
        ))
          await records.write(record)
      })
      .catch(failed(basics, "reading what you are editing"))
  owner.onMoved(moved => {
    const planned = planMarks({
      moved,
      names: readNames(basics.session),
      open: [...readOffers(basics.session).values()]
        .filter(o => isUntaken(offerStatus(o)))
        .map(o => o.lane),
    })
    if (planned.line) markLine()
    if (planned.shared) markShared()
    for (const lane of planned.lanes) touch(lane)
  })

  return {
    async moveLanes(updates) {
      await owner.command(ops => ops.execute(laneRefSteps(updates)))
      for (const { lane } of updates) touch(lane)
    },
    runEnded(lane) {
      // Described whether or not this refresh built: one built while the
      // lane ran was not described then.
      void owner.track(
        mark(lane).then(() => describe(deps, refresh, lane, false)),
      )
    },
    act: (lane, action, by, to = null, seen = null) =>
      act(deps, refresh, lane, action, by, to, seen),
    stackSpan: lane => stackSpan(deps, lane),
    stackEnded: (lane, stack) => stackEnded(deps, refresh, lane, stack),
    async read(ask) {
      const read = planOfferRead(
        {
          offers: readOffers(basics.session),
          // Every held root's: a range is named by two commits, in one lane.
          revisions: new Map(
            basics.docs.loaded().flatMap(root => {
              const view = basics.docs.view(root)
              return view === null ? [] : [...readRevisions(view.doc)]
            }),
          ),
        },
        ask,
      )
      switch (read.kind) {
        case "refused":
          return read
        case "review":
          return answerReview(
            await owner.read(ops => revisionRead(ops.jj, read.span)),
          )
        case "diff":
          return answerDiff(
            await owner.read(ops => fileDiff(ops.jj, read.span, read.path)),
          )
      }
    },
  }
}
