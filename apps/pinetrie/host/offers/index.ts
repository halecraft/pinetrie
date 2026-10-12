// host/offers — each lane's offer in your repo, on the owner of your repo
// (`@pinetrie/repo`).
//
// A refresh is upkeep, at most one queued per lane (`later("refresh:…")`):
// gather (`gatherRefresh`), decide (`planRefresh`), translate (`offerEffects`),
// and execute the steps, then write the `pinetrie.offer` record, the page's
// cache, from the repo (`refresh.ts`). The host decides nothing from a record.
// What marks a lane: a move the owner observes (`planMarks`: the lane's ref
// after a fetch, its offer bookmark, accepted work, a WIP, your `@`), a run's
// end, and a root archived or restored (`moveLanes`); accepted work's record
// (`work/accepted.ts`) is rewritten on the same moves. Commands (an offer
// action, a split's span and end) are owner commands, ahead of every refresh
// waiting. The reads a page asks for (`read`) are pinned reads, which wait on
// nothing.

import type {
  CommitId,
  ErrCode,
  OfferFact,
  OfferSeen,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { RepoConfig } from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { readNames, readOffers, readRevisions } from "@pinetrie/reads"
import {
  fileDiff,
  laneRefSteps,
  type RepoOwner,
  revisionRead,
} from "@pinetrie/repo"
import {
  answerDiff,
  answerReview,
  isNotYetAccepted,
  type OfferAnswer,
  type OfferAsk,
  offerStatus,
  planOfferRead,
  planYourEdits,
} from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import type { AcceptedWork } from "../work/accepted.ts"
import { act } from "./act.ts"
import { describe } from "./describe.ts"
import { planMarks } from "./marks.ts"
import { createRefresh } from "./refresh.ts"
import { stackEnded, stackSpan } from "./stack.ts"
import { createOfferDeps } from "./state.ts"

export interface Offers {
  /**
   * Set lanes' history in your repo, or delete it with a null commit (a root
   * archived or restored), then refresh each lane's offer: an archived thread's
   * is withdrawn, a restored one's built again.
   */
  moveLanes(
    updates: readonly {
      readonly lane: ThreadId
      readonly commit: CommitId | null
    }[],
  ): Promise<void>
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
  /** Where a split's stack starts and ends: the offer's start and the lane's tip. */
  stackSpan(
    lane: ThreadId,
  ): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null>
  /**
   * A split's run ended: its stack, fetched into your repo as `stack`, replaces
   * the offer if it holds exactly the lane tip's files. Returns why not.
   */
  stackEnded(
    lane: ThreadId,
    stack: {
      readonly start: readonly CommitId[]
      readonly tip: CommitId
      readonly top: CommitId | null
    },
  ): Promise<string | null>
  /**
   * A review or a diff a page asked for, of a commit an open offer holds now or
   * a range one lane's turns recorded: gathered, planned (`planOfferRead`), and
   * read pinned to the head the owner last observed, waiting on no write.
   */
  read(ask: OfferAsk): Promise<OfferAnswer>
}

export function startOffers(input: {
  readonly owner: RepoOwner
  /** Accepted work's names. */
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  /** What a description asks of the model. */
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  /** Whether a lane is running now: an offer is described once it stops. */
  readonly running: (lane: ThreadId) => boolean
  /** A lane's base record changed: lane work announces it (`onBaseChanged`). */
  readonly baseChanged: (lane: ThreadId) => void
  /** Accepted work's record and commands (`host/work/accepted.ts`): its record is rewritten when the owner observes accepted work or your `@` move. */
  readonly acceptedWork: AcceptedWork
}): Offers {
  const deps = { ...createOfferDeps(input), describing: new Set<ThreadId>() }
  const { owner, basics, records } = deps
  const refresh = createRefresh(deps)

  /**
   * Refresh `lane`'s offer as upkeep, once however often it is marked
   * before it starts; resolves with whether it built.
   */
  function mark(lane: ThreadId): Promise<boolean> {
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
  const touch = (lane: ThreadId) =>
    void mark(lane).then(built => {
      // Tracked, and logged on failure, by `describe`.
      if (built && !deps.running(lane))
        void describe(deps, refresh, lane, false)
    })

  const acceptedWork = input.acceptedWork
  const markAccepted = () =>
    void acceptedWork.refresh().catch(failed(basics, "reading accepted work"))
  /**
   * Only `@` moved (jjui, an editor): one shared read rewrites each open
   * record's `yourEdits` and accepted work's record, with no lane's jj.
   */
  const markShared = () =>
    void owner
      .later("shared", async ops => {
        const { editing } = await ops.shared()
        await acceptedWork.record(ops)
        for (const record of planYourEdits(
          readOffers(basics.session).values(),
          editing,
        ))
          await records.write(record)
      })
      .catch(failed(basics, "reading what you are editing"))
  owner.onMoved(moved => {
    const names = readNames(basics.session)
    const planned = planMarks({
      moved,
      names,
      archived: new Set([...names.keys()].filter(l => deps.docs.archived(l))),
      open: [...readOffers(basics.session).values()]
        .filter(o => isNotYetAccepted(offerStatus(o)))
        .map(o => o.lane),
    })
    if (planned.accepted) markAccepted()
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
