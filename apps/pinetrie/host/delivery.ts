// host/delivery — a message from the host into a thread, placed as
// `planDelivery` decides: a run started for a message that wakes an idle
// lane, steered into a running one, appended to an idle one, or appended to
// a thread with no lane at its end. Shared by an answer to an ask and a
// lane's ssh news, so one rule says when a message wakes.

import { ERR, type ThreadId } from "@pinetrie/core"
import type { Agent, Scribe } from "@pinetrie/pi"
import { readThreads } from "@pinetrie/reads"
import {
  type AnswerMessage,
  type CarryOnMessage,
  planDelivery,
  type SshFactMessage,
} from "@pinetrie/rules"
import { type Basics, notWritten } from "./basics.ts"
import type { StepDocs } from "./roots.ts"
import type { Runs } from "./runs.ts"
import { threadsNow } from "./threads-now.ts"
import type { LaneWork } from "./work/index.ts"

/**
 * What is delivered: an answer or a lane's ssh news. Only a prompt wakes a
 * lane, since only a prompt starts a run (`startsRun`).
 */
export type Delivered =
  | { readonly wakes: true; readonly message: AnswerMessage | CarryOnMessage }
  | {
      readonly wakes: false
      readonly message: AnswerMessage | SshFactMessage
    }

/**
 * Delivers into `thread` in a late step's documents. `steers`: it may enter
 * a running lane after the turn in flight. "busy" when the lane runs and it
 * may not, or another process left its operation open: the caller decides
 * what waits for the run's end.
 */
export type Deliver = (
  roots: StepDocs,
  thread: ThreadId,
  delivered: Delivered,
  steers: boolean,
) => Promise<"delivered" | "busy">

export function createDelivery(deps: {
  readonly basics: Pick<Basics, "session" | "places" | "live" | "log">
  readonly agent: Pick<Agent, "lane">
  readonly scribe: Pick<Scribe, "appendToTree">
  readonly start: Runs["start"]
  /** Whether a run may start on a lane (`LaneWork.runnable`). */
  readonly runnable: LaneWork["runnable"]
}): Deliver {
  const threads = threadsNow(deps.basics)
  return async (roots, thread, delivered, steers) => {
    const { message, wakes } = delivered
    // pi refuses a lane another process left open as busy, which then waits
    // as a running lane's delivery does.
    const append = async (lane: ThreadId): Promise<"delivered" | "busy"> => {
      const appended = await deps.agent.lane(lane).append(message)
      if (appended.kind === "refused" && appended.code === ERR.BUSY)
        return "busy"
      notWritten(deps.basics, "a delivered message", lane)(appended)
      return "delivered"
    }
    const found = await threads.thread(roots, thread)
    if (found === null) return "delivered"
    const to = planDelivery({
      lane: found.lane,
      compelled: wakes,
      mode: "queue",
      race: null,
      steers,
    })
    switch (to.kind) {
      case "run": {
        // A lane of another kind runs nothing: the message waits in its
        // thread, as one that wakes nobody does.
        const runnable = deps.runnable(to.thread)
        if (!delivered.wakes || typeof runnable === "object")
          return append(to.thread)
        deps.start(roots, runnable, {
          kind: "prompt",
          message: delivered.message,
          pinnedSeen: [],
          incoming: null,
        })
        return "delivered"
      }
      case "steer":
        await deps.agent.lane(to.thread).steer(message)
        return "delivered"
      case "append-to-lane":
        return append(to.thread)
      case "append-to-tree": {
        const root = readThreads(deps.basics.session).get(thread)?.root
        if (root !== undefined && found.end !== null)
          await deps.scribe.appendToTree(
            message,
            { root, at: { kind: "entry", id: found.end } },
            thread,
          )
        return "delivered"
      }
      case "busy":
        return "busy"
      case "create-and-run":
      case "conflict":
        // A host's message never creates a lane, nor races anyone.
        return "delivered"
    }
  }
}
