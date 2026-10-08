// host/runs — a run on a thread's lane, from its start to its end.
//
// The one way a run starts. It announces its end and knows nothing of what
// follows: `startHost` wires the drain and hot reload to `onEnded`, which is
// what keeps the queue's pops and the commands out of this module. What a
// run reads of its pinned cards is `readPinned`'s (`pinned.ts`); what it is
// told of its base's new work, `baseNews`' (`base-news.ts`, ADR-0080).

import {
  type EntryId,
  type RunId,
  runId,
  type SentCard,
  type StreamEvent,
  type ThreadId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import { readLatestPrompt } from "@pinetrie/reads"
import {
  CHAT_TYPE,
  type PinnedMessage,
  type PromptMessage,
  planEndRun,
  planStream,
  settleRun,
} from "@pinetrie/rules"
import {
  applyLiveOps,
  type LiveDocHandle,
  readActiveRun,
  readLaneTip,
  readStreamRecords,
  readStreams,
} from "@pinetrie/schema"
import type { BaseNews } from "./base-news.ts"
import { type Basics, failed } from "./basics.ts"
import type { LaneWork } from "./work/index.ts"

export type RunStart =
  | {
      readonly kind: "prompt"
      readonly message: PromptMessage
      /**
       * The thread's pinned cards as the sender had them, which the run
       * waits for (ADR-0048, S96): a chat's; none for a popped queued card,
       * a landing or a stack.
       */
      readonly pinnedSeen: readonly SentCard[]
    }
  | { readonly kind: "resume" }

/** The cards entry a run on `lane` starts with, or null (`pinned.ts`). */
export type ReadPinned = (
  lane: ThreadId,
  seen: readonly SentCard[],
  signal: AbortSignal,
) => Promise<PinnedMessage | null>

export interface Runs {
  /**
   * Start one turn on a thread's lane, streaming into the document. A
   * prompt's run reads its pinned cards first, which may wait for their text.
   */
  start(lane: ThreadId, start: RunStart): RunId
  /**
   * Stop a chat's run that has not reached pi yet: it is waiting for its
   * pinned cards' text, where pi's `abort` reaches nothing. Its message is
   * kept, unrun. False when no such run waits on `lane`.
   */
  cancel(lane: ThreadId): boolean
  /**
   * Set once: called after each run's end has closed its streams and stopped
   * its lane. Set after `createRuns`, since what it calls starts runs.
   * `prompt` is the run's prompt, read before any step of its end, or null
   * when the lane has none. A listener uses it rather than the lane's tip,
   * which a drain may already have moved on to the next ask.
   */
  onEnded(ended: (lane: ThreadId, prompt: EntryId | null) => void): void
}

/** One step of a run's end, in the order `planRunEnd` returns them. */
export type RunEndStep =
  | "splitEnded"
  | "verdictPending"
  | "endRun"
  | "laneStopped"
  | "ended"

/**
 * A run's end, in order, from its prompt's role. A split checks its stack,
 * however it started. A resolution ends as any run does: its outcome is the
 * offer's conflicts and the agent's asks in the tree (ADR-0080, S104). The run's
 * verdict is pending before `endRun` (ADR-0077): written after, a reader
 * would see the lane stopped beside the last run's verdict. `endRun` comes
 * before `laneStopped` and `ended`: it closes the lane's streams (ADR-0044),
 * and what follows reads the lane as idle.
 */
export function planRunEnd(role: string | undefined): readonly RunEndStep[] {
  const outcome: readonly RunEndStep[] = role === "stack" ? ["splitEnded"] : []
  return [...outcome, "verdictPending", "endRun", "laneStopped", "ended"]
}

/**
 * The agent's `onStream`: gather the lane's streams from `pinetrie:live` and
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
    applyLiveOps(
      live,
      planStream({
        event,
        streams: readStreams(live, event.lane),
        tip: doc === null ? null : readLaneTip(doc, event.lane),
        running: readActiveRun(live, event.lane) !== undefined,
        newId,
      }),
    )
  }

/** `lane`'s run `run` ended: gather, plan (`planEndRun`), write. */
export const endRun = (live: LiveDocHandle, lane: ThreadId, run: RunId): void =>
  applyLiveOps(
    live,
    planEndRun({
      lane,
      run,
      running: readActiveRun(live, lane),
      streams: readStreamRecords(live, lane),
    }),
  )

export function createRuns(deps: {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane">
  readonly work: Pick<LaneWork, "beforeRun" | "runEnded" | "splitEnded">
  readonly readPinned: ReadPinned
  /** What a chat's run is told first of its base's new work, and forgetting what was steered once the lane stops. */
  readonly baseNews: Pick<BaseNews, "atStart" | "runEnded">
  /** Write `lane`'s run's verdict as pending (`Digests.pending`). */
  readonly pending: (lane: ThreadId, prompt: EntryId) => Promise<void>
}): Runs {
  const { basics, agent, work, readPinned, baseNews } = deps
  const { docs, live, log } = basics
  let ended: (lane: ThreadId, prompt: EntryId | null) => void = () => {}
  /**
   * A chat's run between its start and pi's, by lane. Only a chat's: a land
   * or stack run cancelled here would write no prompt, and `end` would read
   * the lane's previous one, and could check an old split's stack again.
   */
  const waiting = new Map<ThreadId, AbortController>()

  /**
   * Carry out `planRunEnd`. The steps before `endRun` may fail, and a failure
   * is logged; `endRun` and every step after it always run.
   */
  async function end(lane: ThreadId, id: RunId): Promise<void> {
    const doc = docs.docOfLane(lane)
    const prompt = doc === null ? null : readLatestPrompt(doc, lane)
    const steps = planRunEnd(prompt?.role)
    const cut = steps.indexOf("endRun")
    const carry = async (step: RunEndStep) => {
      switch (step) {
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
          baseNews.runEnded(lane)
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
      applyLiveOps(live, [{ kind: "begin", lane, run: id }])
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
          // A chat's run is told its base's new work first (ADR-0080); a
          // resolution or a split has a prompt of its own.
          const behind =
            chat === null
              ? null
              : await baseNews.atStart(lane).catch(error => {
                  failed(basics, "the base's news")(error)
                  return null
                })
          // The cards entry stays the prompt's parent.
          const before = [behind, pinned].filter(m => m !== null)
          const ran = await handle.run(start.message, before)
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
