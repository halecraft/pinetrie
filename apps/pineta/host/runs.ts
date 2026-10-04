// host/runs — a run on a thread's lane, from its start to its end.
//
// The one way a run starts. It announces its end and knows nothing of what
// follows: `startHost` wires the drain and hot reload to `onEnded`, which is
// what keeps the queue's take and the commands out of this module. What a
// run reads of its pinned cards is `readPinned`'s (`pinned.ts`).

import {
  type EntryId,
  type LaneName,
  type RunId,
  runId,
  type SentCard,
  type StreamEvent,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import { readLatestPrompt } from "@pineta/reads"
import {
  CHAT_TYPE,
  type ChatMessage,
  type LandMessage,
  type PinnedMessage,
  type StackMessage,
  settleRun,
} from "@pineta/rules"
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
      /**
       * The thread's pinned cards as the sender had them, which the run
       * waits for (ADR-0048, S96): a chat's; none for a take, a landing or
       * a stack.
       */
      readonly pinnedSeen: readonly SentCard[]
    }
  | { readonly kind: "resume" }

/** The cards entry a run on `lane` starts with, or null (`pinned.ts`). */
export type ReadPinned = (
  lane: LaneName,
  seen: readonly SentCard[],
  signal: AbortSignal,
) => Promise<PinnedMessage | null>

export interface Runs {
  /**
   * Start one turn on a thread's lane, streaming into the document. A
   * prompt's run reads its pinned cards first, which may wait for their text.
   */
  start(lane: LaneName, start: RunStart): RunId
  /**
   * Stop a chat's run that has not reached pi yet: it is waiting for its
   * pinned cards' text, where pi's `abort` reaches nothing. Its message is
   * kept, unrun. False when no such run waits on `lane`.
   */
  cancel(lane: LaneName): boolean
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
  | "verdictPending"
  | "endRun"
  | "laneStopped"
  | "ended"

/**
 * A run's end, in order, from its prompt's role. A resolution records its
 * outcome and a split checks its stack, however they started. The run's
 * verdict is pending before `endRun` (ADR-0077): written after, a reader
 * would see the lane stopped beside the last run's verdict. `endRun` comes
 * before `laneStopped` and `ended`: it closes the lane's streams (ADR-0044),
 * and what follows reads the lane as idle.
 */
export function planRunEnd(role: string | undefined): readonly RunEndStep[] {
  const outcome: readonly RunEndStep[] =
    role === "land" ? ["landingEnded"] : role === "stack" ? ["splitEnded"] : []
  return [...outcome, "verdictPending", "endRun", "laneStopped", "ended"]
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
  readonly readPinned: ReadPinned
  /** Write `lane`'s run's verdict as pending (`Digests.pending`). */
  readonly pending: (lane: LaneName, prompt: EntryId) => Promise<void>
}): Runs {
  const { basics, agent, work, readPinned } = deps
  const { docs, live, log } = basics
  let ended: (lane: LaneName, prompt: EntryId | null) => void = () => {}
  /**
   * A chat's run between its start and pi's, by lane. Only a chat's: a land
   * or stack run cancelled here would write no prompt, and `end` would read
   * the lane's previous one, recording an old landing's outcome again.
   */
  const waiting = new Map<LaneName, AbortController>()

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
        case "verdictPending":
          if (prompt !== null) await deps.pending(lane, prompt.id)
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
      // A chat's message, which is kept if its run never happens.
      const chat =
        start.kind === "prompt" && start.message.customType === CHAT_TYPE
          ? start.message
          : null
      const stop = new AbortController()
      if (chat !== null) waiting.set(lane, stop)
      void (async () => {
        try {
          work.beforeRun(lane)
          if (start.kind === "resume") {
            await handle.resume()
            return
          }
          const pinned = await readPinned(
            lane,
            start.pinnedSeen,
            stop.signal,
          ).catch(error => {
            failed(basics, "pinned cards")(error)
            return null
          })
          if (waiting.get(lane) === stop) waiting.delete(lane)
          if (chat !== null && stop.signal.aborted) {
            log(`[host] run ${id.slice(-8)} stopped before it started`)
            await handle.append(chat)
            return
          }
          const ran = await handle.run(start.message, pinned)
          if (chat !== null && settleRun(ran) === "keep") {
            // The reply was already `started`, so the author cannot be told;
            // at least their message is not lost.
            log(`[host] run ${id.slice(-8)} REFUSED: kept as a message`)
            await handle.append(chat)
          }
        } catch (error) {
          failed(basics, "run")(error)
        } finally {
          await end(lane, id)
        }
      })()
      return id
    },
    cancel(lane) {
      const stop = waiting.get(lane)
      if (stop === undefined) return false
      waiting.delete(lane)
      stop.abort()
      return true
    },
    onEnded(listener) {
      ended = listener
    },
  }
}
