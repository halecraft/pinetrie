// host/work/line — the integration line in your repo (ADR-0060, ADR-0061):
// its record, read whenever the owner observes a move that changes it, and
// the `line` commands. Gather (the shared facts' `lineFacts`), decide
// (`planLineRecord`, `planLineAction`), translate (`lineProposal`,
// `lineSteps`) and execute, each in one step on the owner: the record as
// upkeep (`later("line")`), a command as a command.

import type { ErrCode, LineAction, LineRecord, ValueWrite } from "@pineta/core"
import type { LineConfig } from "@pineta/lanes"
import { readLine } from "@pineta/reads"
import {
  lineProposal,
  lineSteps,
  type RepoOps,
  type RepoOwner,
} from "@pineta/repo"
import {
  LINE,
  planLineAction,
  planLineRecord,
  setIfChanged,
} from "@pineta/rules"
import type { Basics } from "../basics.ts"

export interface Line {
  /** Read the line and write its record when it changed, as upkeep. */
  refresh(): Promise<void>
  /** The line's record, from the step's shared facts, written when it changed. */
  record(ops: RepoOps): Promise<LineRecord>
  /** A `line` command; null when carried out, else why not. */
  act(action: LineAction): Promise<ErrCode | null>
}

export function createLine(deps: {
  readonly owner: RepoOwner
  readonly basics: Pick<Basics, "session">
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /** Whether this host takes `line` commands: it admits no one else. */
  readonly lineCommands: boolean
  readonly writeValues: (writes: readonly ValueWrite[]) => Promise<void>
  /** After a land: the base snapshot follows the line. */
  readonly taken: () => void
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

  return {
    refresh: () => owner.later("line", async ops => void (await record(ops))),
    record,
    act: action =>
      owner.command(async ops => {
        const planned = planLineAction(action, await record(ops))
        if (planned.kind === "refused") return planned.code
        await ops.execute(lineSteps(planned))
        await record(ops)
        deps.taken()
        return null
      }),
  }
}
