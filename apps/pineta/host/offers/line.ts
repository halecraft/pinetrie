// host/offers/line — the integration line in your repo (ADR-0060): its
// record, read whenever the owner observes a move that changes it, and the
// `line` commands. Gather (the shared facts' `lineFacts`), plan (`planLineRecord`,
// `planLineAction`), execute, each in one step on the owner: the record as
// upkeep (`later("line")`), a command as a command.

import type { ErrCode, LineAction, LineRecord } from "@pineta/core"
import { LINE, setIfChanged } from "@pineta/marginalia"
import { readLine } from "@pineta/reads"
import type { RepoOps } from "@pineta/repo"
import { planLineAction, planLineRecord } from "./plan.ts"
import type { OfferState } from "./state.ts"

export interface Line {
  /** Read the line and write its record when it changed, as upkeep. */
  refresh(): Promise<void>
  /** The line's record, from the step's shared facts, written when it changed. */
  record(ops: RepoOps): Promise<LineRecord>
  /** A `line` command; null when carried out, else why not. */
  act(action: LineAction): Promise<ErrCode | null>
}

export function createLine(state: OfferState): Line {
  const { owner, basics } = state
  const { session: doc } = basics

  async function record(ops: RepoOps) {
    const next = planLineRecord(
      (await ops.shared()).line,
      state.line,
      state.lineCommands,
    )
    await state.writeValues(
      setIfChanged(LINE, next, readLine(doc) ?? undefined),
    )
    return next
  }

  return {
    refresh: () => owner.later("line", async ops => void (await record(ops))),
    record,
    act: action =>
      owner.command(async ops => {
        const planned = planLineAction(action, await record(ops))
        if (planned.kind === "refused") return planned.code
        await ops.execute(planned.steps)
        await record(ops)
        state.taken()
        return null
      }),
  }
}
