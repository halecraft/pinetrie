// host/runs — a run on a thread's lane, from its start to its end.
//
// The one way a run starts. It announces its end and knows nothing of what
// follows: `startHost` wires the drain and hot reload to `onEnded`, which is
// what keeps the queue's take and the commands out of this module.

import {
  type EntryId,
  type LaneName,
  type RunId,
  runId,
  type StreamEvent,
} from "@pineta/core"
import {
  CHAT_TYPE,
  type ChatMessage,
  type LandMessage,
  type StackMessage,
  settleRun,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readLatestPrompt } from "@pineta/reads"
import {
  applyStreamOps,
  beginRun,
  endRun,
  planStream,
  readActiveRun,
  readLaneTip,
  readStreams,
} from "@pineta/schema"
import { type Basics, failed } from "./basics.ts"
import type { LaneWork } from "./work/index.ts"

export type RunStart =
  | {
      readonly kind: "prompt"
      readonly message: ChatMessage | LandMessage | StackMessage
    }
  | { readonly kind: "resume" }

export interface Runs {
  /** Start one turn on a thread's lane, streaming into the document. */
  start(lane: LaneName, start: RunStart): RunId
  /**
   * Set once: called after each run's end has closed its streams and stopped
   * its lane. Set after `createRuns`, since what it calls starts runs.
   * `prompt` is the run's prompt, read before any step of its end, or null
   * when the lane has none. A listener uses it rather than the lane's tip,
   * which a drain may already have moved on to the next ask.
   */
  onEnded(ended: (lane: LaneName, prompt: EntryId | null) => void): void
}

/** One step of a run's end, in the order `planRunEnd` returns them. */
export type RunEndStep =
  | "landingEnded"
  | "splitEnded"
  | "endRun"
  | "laneStopped"
  | "ended"

/**
 * A run's end, in order, from its prompt's role. A resolution records its
 * outcome and a split checks its stack, however they started. `endRun` comes
 * before `laneStopped` and `ended`: it closes the lane's streams (ADR-0044),
 * and what follows reads the lane as idle.
 */
export function planRunEnd(role: string | undefined): readonly RunEndStep[] {
  const outcome: readonly RunEndStep[] =
    role === "land" ? ["landingEnded"] : role === "stack" ? ["splitEnded"] : []
  return [...outcome, "endRun", "laneStopped", "ended"]
}

/**
 * The agent's `onStream`: gather the lane's streams from `pineta:live` and
 * its tip from its root's document, plan, execute. A lane runs only in a
 * root the host holds. The documents record what each
 * lane is running and streaming; a second copy here would be two sources of
 * truth.
 */
export const streamInto =
  (basics: Pick<Basics, "docs" | "live" | "newId">) =>
  (event: StreamEvent): void => {
    const { docs, live, newId } = basics
    const doc = docs.docOfLane(event.lane)
    applyStreamOps(
      live,
      planStream({
        event,
        streams: readStreams(live),
        tip: doc === null ? null : readLaneTip(doc, event.lane),
        running: readActiveRun(live, event.lane) !== undefined,
        newId,
      }),
    )
  }

export function createRuns(deps: {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane">
  readonly work: Pick<
    LaneWork,
    "beforeRun" | "runEnded" | "landingEnded" | "splitEnded"
  >
}): Runs {
  const { basics, agent, work } = deps
  const { docs, live, log } = basics
  let ended: (lane: LaneName, prompt: EntryId | null) => void = () => {}

  /**
   * Carry out `planRunEnd`. The steps before `endRun` may fail, and a failure
   * is logged; `endRun` and every step after it always run.
   */
  async function end(lane: LaneName, id: RunId): Promise<void> {
    const doc = docs.docOfLane(lane)
    const prompt = doc === null ? null : readLatestPrompt(doc, lane)
    const steps = planRunEnd(prompt?.role)
    const cut = steps.indexOf("endRun")
    const carry = async (step: RunEndStep) => {
      switch (step) {
        case "landingEnded":
          if (prompt !== null) await work.landingEnded(lane, prompt.id)
          return
        case "splitEnded":
          if (prompt !== null) await work.splitEnded(lane, prompt.id)
          return
        case "endRun":
          return endRun(live, lane, id)
        case "laneStopped":
          work.runEnded(lane)
          log(`[host] run ${id.slice(-8)} done`)
          return
        case "ended":
          return ended(lane, prompt?.id ?? null)
      }
    }
    try {
      for (const step of steps.slice(0, cut)) await carry(step)
    } catch (error) {
      failed(basics, "run end")(error)
    }
    for (const step of steps.slice(cut)) await carry(step)
  }

  return {
    start(lane, start) {
      const id = runId(basics.newId())
      beginRun(live, lane, id)
      const handle = agent.lane(lane)
      void (async () => {
        try {
          work.beforeRun(lane)
          const ran =
            start.kind === "prompt"
              ? await handle.run(start.message)
              : await handle.resume()
          if (
            start.kind === "prompt" &&
            start.message.customType === CHAT_TYPE &&
            settleRun(ran) === "keep"
          ) {
            // The reply was already `started`, so the author cannot be told;
            // at least their message is not lost.
            log(`[host] run ${id.slice(-8)} REFUSED: kept as a message`)
            await handle.append(start.message)
          }
        } catch (error) {
          failed(basics, "run")(error)
        } finally {
          await end(lane, id)
        }
      })()
      return id
    },
    onEnded(listener) {
      ended = listener
    },
  }
}
