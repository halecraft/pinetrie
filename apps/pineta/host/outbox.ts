// host/outbox — a now-idle lane's held messages and updates, oldest first.

import type { LaneName, WriterId } from "@pineta/core"
import { encodeChat, planDrain } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readOutbox } from "@pineta/reads"
import type { Basics } from "./basics.ts"
import type { Runs } from "./runs.ts"

export interface DrainDeps {
  readonly basics: Pick<Basics, "doc" | "log">
  readonly agent: Pick<Agent, "lane" | "release">
  readonly start: Runs["start"]
  /** An update, as its command runs it: passed in, so this module imports no command. */
  readonly update: (lane: LaneName, by: WriterId) => Promise<Outcome>
}

/**
 * A plain message is appended and the step goes on; a compelled one is run,
 * and its end brings the next step. The lane is never written while it runs
 * (S21).
 */
export async function drain(deps: DrainDeps, lane: LaneName): Promise<void> {
  const { agent } = deps
  const { doc, log } = deps.basics
  for (;;) {
    const step = planDrain(readOutbox(doc), lane)
    if (step.kind === "idle") return
    if (step.kind === "update") {
      // Released first: the update owns it from here, as a run owns its
      // message. A resolution run's end brings the next step; a clean one
      // goes on to the next held item.
      await agent.release(step.held.id)
      const outcome = await deps.update(lane, step.held.by)
      if (outcome.kind === "started") return
      continue
    }
    const message = encodeChat(step.held.details, step.held.timestamp)
    if (step.kind === "append") {
      // Released only once written: a refused append stays held, and is
      // taken again when the lane's next run ends.
      const appended = await agent.lane(lane).append(message)
      if (appended.kind === "refused") {
        log(`[host] held message kept: append refused (${appended.code})`)
        return
      }
      await agent.release(step.held.id)
      continue
    }
    // The run owns the message from here: if pi refuses it, `settleRun`
    // keeps it in the tree.
    await agent.release(step.held.id)
    deps.start(lane, { kind: "prompt", message })
    return
  }
}
