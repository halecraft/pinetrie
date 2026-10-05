// host/work/line — the integration line in your repo (ADR-0060, ADR-0061):
// its record, read whenever the owner observes a move that changes it, and
// the `line` commands. Gather (the shared facts' `lineFacts`), decide
// (`planLineRecord`, `planLineAction`), translate (`lineProposal`,
// `lineSteps`) and execute, each in one step on the owner: the record as
// upkeep (`later("line")`), a command as a command.

import type {
  ErrCode,
  LineAction,
  LineRecord,
  ValueWrite,
} from "@pinetrie/core"
import type { LineConfig } from "@pinetrie/lanes"
import { readLine } from "@pinetrie/reads"
import {
  lineProposal,
  lineSteps,
  type RepoOps,
  type RepoOwner,
} from "@pinetrie/repo"
import {
  LINE,
  lineRefusal,
  planLineAction,
  planLineRecord,
  setIfChanged,
} from "@pinetrie/rules"
import type { Basics } from "../basics.ts"

export interface Line {
  /** Read the line and write its record when it changed, as upkeep. */
  refresh(): Promise<void>
  /** The line's record, from the step's shared facts, written when it changed. */
  record(ops: RepoOps): Promise<LineRecord>
  /**
   * A `line` command; null when carried out, else why not, worded
   * (`lineRefusal`) from the record it was decided on.
   */
  act(
    action: LineAction,
  ): Promise<{ readonly code: ErrCode; readonly message: string } | null>
}

export function createLine(deps: {
  readonly owner: RepoOwner
  readonly basics: Pick<Basics, "session">
  /** The integration line's names (ADR-0060). */
  readonly line: LineConfig
  /**
   * Whether this host accepts the owner's `line` commands: it admits no one
   * else. Publishing is anyone's (ADR-0076).
   */
  readonly lineCommands: boolean
  readonly writeValues: (writes: readonly ValueWrite[]) => Promise<void>
  /** After the line moved (set up, or your work added): the base snapshot follows it. */
  readonly lineMoved: () => void
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
        const now = await record(ops)
        const planned = planLineAction(action, now)
        if (planned.kind === "refused")
          return {
            code: planned.code,
            message: lineRefusal(action, planned.code, now),
          }
        await ops.execute(lineSteps(planned))
        await record(ops)
        // Updating your files and publishing leave the line where it was.
        if (planned.kind === "setup" || planned.kind === "land")
          deps.lineMoved()
        return null
      }),
  }
}
