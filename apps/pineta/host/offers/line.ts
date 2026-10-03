// host/offers/line — the integration line in your repo (ADR-0060): its
// record, read whenever your repo's operation head moves, and the `line`
// commands. Gather (`lineFacts`), plan (`planLineRecord`, `planLineAction`),
// execute, each in one step on the offers' queue.

import type { ErrCode, LineAction } from "@pineta/core"
import {
  executeOnHost,
  hostRunner,
  lineFacts,
  type Runner,
} from "@pineta/lanes"
import { LINE, setIfChanged } from "@pineta/marginalia"
import { readLine } from "@pineta/reads"
import { planLineAction, planLineRecord } from "./plan.ts"
import type { OfferState } from "./state.ts"

export interface Line {
  /** Read the line and write its record when it changed. On the queue. */
  refresh(): Promise<void>
  /** A `line` command; null when carried out, else why not. */
  act(action: LineAction): Promise<ErrCode | null>
}

export function createLine(state: OfferState): Line {
  const { ops, root, basics } = state
  const { session: doc } = basics
  const git: Runner = args => hostRunner(root)(["git", ...args])

  async function record() {
    const next = planLineRecord(
      await lineFacts(ops, git, state.line),
      state.line,
      state.lineCommands,
    )
    await state
      .agent()
      .writeValues(setIfChanged(LINE, next, readLine(doc) ?? undefined))
    return next
  }

  return {
    refresh: () => state.serial.run(async () => void (await record())),
    act: action =>
      state.serial.run(async () => {
        const planned = planLineAction(action, await record(), root)
        if (planned.kind === "refused") return planned.code
        await executeOnHost(planned.steps)
        await record()
        state.taken()
        return null
      }),
  }
}
