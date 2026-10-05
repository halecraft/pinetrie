// host/work/line — the integration line in your repo (ADR-0060, ADR-0090):
// its record, read whenever the owner observes a move that changes it, and
// the `line` commands. Gather (the shared facts' `lineFacts`), decide
// (`planLineRecord`, `planLineAction`, `planPublishFinish`), translate
// (`lineProposal`, `planLineSetup` and the publish's steps) and execute, on
// the owner: the record as upkeep (`later("line")`), a command as a command.

import type {
  ErrCode,
  LineAction,
  LineRecord,
  PublishDecision,
  ValueWrite,
} from "@pinetrie/core"
import type { LineConfig } from "@pinetrie/lanes"
import { readLine } from "@pinetrie/reads"
import {
  lineProposal,
  planCatchUpUndo,
  planLineSetup,
  planPublishCatchUp,
  planPublishMove,
  type RepoOps,
  type RepoOwner,
} from "@pinetrie/repo"
import {
  LINE,
  lineRefusal,
  planLineAction,
  planLineRecord,
  planPublishFinish,
  publishUndone,
  setIfChanged,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"

/** A `line` command's answer: null when carried out, else why not, worded. */
type LineAnswer = { readonly code: ErrCode; readonly message: string } | null

export interface Line {
  /** Read the line and write its record when it changed, as upkeep. */
  refresh(): Promise<void>
  /** The line's record, from the step's shared facts, written when it changed. */
  record(ops: RepoOps): Promise<LineRecord>
  /**
   * A `line` command; null when carried out, else why not, worded
   * (`lineRefusal`) from the record it was decided on.
   */
  act(action: LineAction): Promise<LineAnswer>
}

export function createLine(deps: {
  readonly owner: Pick<RepoOwner, "later" | "command">
  readonly basics: Pick<Basics, "session">
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /**
   * Whether this host accepts the owner's `line` commands: it admits no one
   * else. Moving the publish bookmark is anyone's (ADR-0076).
   */
  readonly lineCommands: boolean
  readonly writeValues: (writes: readonly ValueWrite[]) => Promise<void>
}): Line {
  const { owner, line } = deps
  const { session: doc } = deps.basics

  async function record(ops: RepoOps) {
    const facts = (await ops.shared()).line
    const next = planLineRecord({
      facts,
      line,
      proposed: lineProposal(line, facts),
      commands: deps.lineCommands,
    })
    const writes = setIfChanged(LINE, next, readLine(doc) ?? undefined)
    if (writes.length > 0) await deps.writeValues(writes)
    return next
  }

  /**
   * A publish in two rounds (ADR-0090): the catch-up, then, from the line read
   * again, the move or the catch-up reverted (`planPublishFinish`). A move jj
   * refuses after a catch-up reverts it too, so nothing is left half done.
   */
  async function publish(
    ops: RepoOps,
    decision: PublishDecision,
  ): Promise<LineAnswer> {
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
    refresh: () => owner.later("line", async ops => void (await record(ops))),
    record,
    act: action =>
      owner.command(async ops => {
        const now = await record(ops)
        const planned = planLineAction(action, now)
        if (planned.kind === "refused")
          return {
            code: planned.code,
            message: lineRefusal(action, planned.code, now),
          }
        if (planned.kind === "setup") await ops.execute(planLineSetup(planned))
        const answer =
          planned.kind === "publish" ? await publish(ops, planned) : null
        await record(ops)
        return answer
      }),
  }
}
