// host/work/accepted — accepted work in your repo: its record, read whenever
// the owner observes a move that changes it, and setup and publish. Gather (the
// shared facts' `acceptedFacts`), decide (`planAcceptedRecord`,
// `planAcceptedAction`, `planPublishFinish`), translate (`setupProposal`,
// `planSetup` and the publish's steps) and execute, on the owner: the record as
// upkeep (`later("accepted")`), a command as a command.

import type {
  AcceptedAction,
  AcceptedRecord,
  ErrCode,
  PublishDecision,
  ValueWrite,
} from "@pinetrie/core"
import type { RepoConfig } from "@pinetrie/lanes"
import { readAccepted } from "@pinetrie/reads"
import {
  planCatchUpUndo,
  planPublishCatchUp,
  planPublishMove,
  planSetup,
  type RepoOps,
  type RepoOwner,
  setupProposal,
} from "@pinetrie/repo"
import {
  ACCEPTED,
  acceptedRefusal,
  planAcceptedAction,
  planAcceptedRecord,
  planPublishFinish,
  publishUndone,
  setIfChanged,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"

/** A setup's or a publish's answer: null when carried out, else why not, worded. */
type AcceptedAnswer = {
  readonly code: ErrCode
  readonly message: string
} | null

export interface AcceptedWork {
  /** Read accepted work and write its record when it changed, as upkeep. */
  refresh(): Promise<void>
  /** Accepted work's record, from the step's shared facts, written when it changed. */
  record(ops: RepoOps): Promise<AcceptedRecord>
  /**
   * A setup or publish; null when carried out, else why not, worded
   * (`acceptedRefusal`) from the record it was decided on.
   */
  act(action: AcceptedAction): Promise<AcceptedAnswer>
}

export function createAcceptedWork(deps: {
  readonly owner: Pick<RepoOwner, "later" | "command">
  readonly basics: Pick<Basics, "session">
  /** Accepted work's names and `publish.catchUp`. */
  readonly repoConfig: RepoConfig
  readonly writeValues: (writes: readonly ValueWrite[]) => Promise<void>
}): AcceptedWork {
  const { owner, repoConfig } = deps
  const { session: doc } = deps.basics

  async function record(ops: RepoOps) {
    const facts = (await ops.shared()).accepted
    const next = planAcceptedRecord({
      facts,
      repoConfig,
      proposed: setupProposal(repoConfig, facts),
    })
    const writes = setIfChanged(ACCEPTED, next, readAccepted(doc) ?? undefined)
    if (writes.length > 0) await deps.writeValues(writes)
    return next
  }

  /**
   * A publish in two rounds: the catch-up, then, from accepted work read again,
   * the move or the catch-up reverted (`planPublishFinish`). A move jj refuses
   * after a catch-up reverts it too, so nothing is left half done.
   */
  async function publish(
    ops: RepoOps,
    decision: PublishDecision,
  ): Promise<AcceptedAnswer> {
    let op: string | null = null
    if (decision.catchUp) {
      await ops.execute(planPublishCatchUp(decision))
      op = (await ops.shared()).op
    }
    const after = await record(ops)
    const finish = planPublishFinish({ decision, after, op })
    if (finish.kind === "undo") {
      await ops.execute(planCatchUpUndo(finish.op))
      return { code: finish.code, message: publishUndone(finish.code, after) }
    }
    try {
      await ops.execute(planPublishMove(finish))
    } catch (e) {
      if (op !== null) await ops.execute(planCatchUpUndo(op))
      throw e
    }
    return null
  }

  return {
    refresh: () =>
      owner.later("accepted", async ops => void (await record(ops))),
    record,
    act: action =>
      owner.command(async ops => {
        const now = await record(ops)
        const planned = planAcceptedAction(action, now)
        if (planned.kind === "refused")
          return {
            code: planned.code,
            message: acceptedRefusal(action, planned.code, now),
          }
        if (planned.kind === "setup") await ops.execute(planSetup(planned))
        const answer =
          planned.kind === "publish" ? await publish(ops, planned) : null
        await record(ops)
        return answer
      }),
  }
}
