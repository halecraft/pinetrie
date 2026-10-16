// host/jj/proposed — each lane's proposed changes in your repo, on the owner of
// your repo (`@pinetrie/jj`).
//
// A refresh is upkeep, at most one queued per lane (`later("refresh:…")`):
// gather (`gatherRefresh`), decide (`planRefresh`), translate
// (`proposedChangesEffects`), and execute the steps, then write the
// `pinetrie.proposed` record, the page's cache, from the repo (`refresh.ts`).
// The host decides nothing from a record. What marks a lane: a move the owner
// observes (`planMarks`: the lane's ref after a fetch, its proposed bookmark,
// accepted work, a WIP, your `@`), a run's end, and a root archived or restored
// (`moveLanes`); accepted work's record (`jj/accepted.ts`) is rewritten on the
// same moves. Commands (proposed changes action, a split's span and end) are
// owner commands, ahead of every refresh waiting. The reads a page asks for
// (`read`) are pinned reads, which wait on nothing.

import {
  type CommitId,
  type ErrCode,
  PROJECT_CONFIG_FILE,
  type ProposedChangesFact,
  type ProposedChangesSeen,
  type RepoConfig,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type CommitSpan,
  commitFromPoint,
  fileDiff,
  laneRefSteps,
  type RepoOwner,
  revisionRead,
} from "@pinetrie/jj"
import type { PiSetup } from "@pinetrie/pi"
import { readLaneRecords, readNames, readProposedByLane } from "@pinetrie/reads"
import {
  answerDiff,
  answerReview,
  isNotYetAccepted,
  planReviewRead,
  planYourEdits,
  proposedChangesStatus,
  type RecordedSpan,
  type ReviewAnswer,
  type ReviewAsk,
} from "@pinetrie/rules"
import { type Basics, failed } from "../../basics.ts"
import { createDescriber } from "../../describe.ts"
import type { Records } from "../../records.ts"
import { decodeAuthority } from "../../settings.ts"
import { reviewReadFacts } from "../../work/destination.ts"
import type { AcceptedWork } from "../accepted.ts"
import { recordedJjLane } from "../proven.ts"
import { act } from "./act.ts"
import { describe } from "./describe.ts"
import { planMarks } from "./marks.ts"
import { createRefresh } from "./refresh.ts"
import { stackEnded, stackSpan } from "./stack.ts"
import { createProposedChangesDeps } from "./state.ts"

export interface ProposedChanges {
  /**
   * Set lanes' history in your repo, or delete it with a null commit (a root
   * archived or restored), then refresh each lane's proposed changes: an
   * archived thread's is withdrawn, a restored one's built again.
   */
  moveLanes(
    updates: readonly {
      readonly lane: ThreadId
      readonly commit: CommitId | null
    }[],
  ): Promise<void>
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
    | { readonly kind: "refused"; readonly code: ErrCode }
    | { readonly kind: "done"; readonly fact: ProposedChangesFact }
  >
  /** Where a split's stack starts and ends: the proposed changes' start and the lane's tip. */
  stackSpan(
    lane: ThreadId,
  ): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null>
  /**
   * A split's run ended: its stack, fetched into your repo as `stack`, replaces
   * the proposed changes if it holds exactly the lane tip's files. Returns why
   * not.
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
   * A review or a diff a page asked for, of a commit open proposed changes hold
   * now or a range one lane's turns recorded: gathered, planned
   * (`planReviewRead`), and read pinned to the head the owner last observed,
   * waiting on no write.
   */
  read(ask: ReviewAsk): Promise<ReviewAnswer>
}

export function startProposedChanges(input: {
  readonly owner: RepoOwner
  /** Accepted work's names. */
  readonly repoConfig: RepoConfig
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  /** What a description asks of the model. */
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  /** Whether a lane is running now: proposed changes are described once it stops. */
  readonly running: (lane: ThreadId) => boolean
  /** A lane's base record changed: lane work announces it (`onBaseChanged`). */
  readonly baseChanged: (lane: ThreadId) => void
  /** Accepted work's record and commands (`host/jj/accepted.ts`): its record is rewritten when the owner observes accepted work or your `@` move. */
  readonly acceptedWork: AcceptedWork
}): ProposedChanges {
  const deps = {
    ...createProposedChangesDeps(input),
    describer: createDescriber({
      basics: input.basics,
      piSetup: input.piSetup,
    }),
  }
  const { owner, basics, records } = deps
  const refresh = createRefresh(deps)

  /**
   * Refresh `lane`'s proposed changes as upkeep, once however often it is
   * marked before it starts; resolves with whether it built.
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
          failed(basics, "refreshing its proposed changes", lane)(error)
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
          readProposedByLane(basics.session).values(),
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
      open: [...readProposedByLane(basics.session).values()]
        .filter(o => isNotYetAccepted(proposedChangesStatus(o)))
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
      /** The span in commits: a range's points read in its lane, proven jj; null when it is not. */
      const spanInCommits = (span: RecordedSpan): CommitSpan | null => {
        if (span.kind === "revision") return span
        const lane = recordedJjLane(readLaneRecords(basics.session), span.lane)
        return lane === null
          ? null
          : {
              kind: "range",
              from: commitFromPoint(lane, span.from),
              to: commitFromPoint(lane, span.to),
            }
      }
      const read = planReviewRead(reviewReadFacts(basics), ask)
      if (read.kind === "refused") return read
      // A range names its lane's points: read only in that lane, proven jj.
      const span = spanInCommits(read.span)
      if (span === null)
        return {
          kind: "refused",
          status: 404,
          reason: "no jj lane recorded both",
        }
      switch (read.kind) {
        case "review":
          return answerReview(
            await owner.read(ops =>
              // A widening names a mount by its target: the root does not matter.
              revisionRead(
                ops.jj,
                span,
                text =>
                  decodeAuthority("/", PROJECT_CONFIG_FILE, text).authority,
              ),
            ),
          )
        case "diff":
          return answerDiff(
            await owner.read(ops => fileDiff(ops.jj, span, read.path)),
          )
      }
    },
  }
}
