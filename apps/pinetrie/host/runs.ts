// host/runs — a run on a thread's lane, from its start to its end.
//
// The one way a run starts. It announces its end and knows nothing of what
// follows: `startHost` wires the drain and hot reload to `onEnded`, which is
// what keeps the queue's pops and the commands out of this module. What a run
// reads of its pinned cards is `readPinned`'s (`pinned.ts`); what it is told of
// its base's new work, `baseNews`' (`base-news.ts`).

import {
  type EntryId,
  type Refusal,
  type Role,
  type RunId,
  type RunnableLane,
  runId,
  type SentCard,
  type StreamEvent,
  type ThreadId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import { readLatestPrompt, readThreadName } from "@pinetrie/reads"
import {
  foreignRefusal,
  type IncomingEntriesMessage,
  MESSAGE_TYPE,
  type PinnedMessage,
  type PromptMessage,
  planEndRun,
  planStream,
  settleRun,
} from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
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
import type { CanvasContext } from "./canvas.ts"
import type { Lease, StepDocs } from "./roots.ts"
import type { LaneWork } from "./work/index.ts"

export type RunStart =
  | {
      readonly kind: "prompt"
      readonly message: PromptMessage
      /**
       * The thread's pinned cards as the sender had them, which the run waits
       * for: a chat's; none for a popped queued card, a landing or a stack.
       */
      readonly pinnedSeen: readonly SentCard[]
      /**
       * What an asked agent heard of the thread that asked, written first,
       * before its relayed ask; absent for every other run.
       */
      readonly incoming?: IncomingEntriesMessage | null
    }
  | { readonly kind: "resume" }

/** The cards entry a run on `lane` starts with, or null (`pinned.ts`). */
export type ReadPinned = (
  lane: ThreadId,
  seen: readonly SentCard[],
  signal: AbortSignal,
) => Promise<PinnedMessage | null>

/** What a run on `lane` is told of its canvas first (`canvas.ts`). */
export type ReadCanvasContext = (lane: ThreadId) => Promise<CanvasContext>

/**
 * A running lane's root, through the lease its run holds from its start
 * until its end's last step has run. What reads a run's root (its stream, its
 * pinned cards, its canvas's context, its budget, its pending run-end report) reads it
 * here; null is "no run". The leases say what must stay in memory: which
 * lanes run is `pinetrie:live`'s.
 */
export interface RunDocs {
  docOf(lane: ThreadId): RootDocHandle | null
}

/** The runs' leases, by lane: `hold` as a run starts, `drop` as it ends. */
export function createRunDocs(): RunDocs & {
  hold(lane: ThreadId, lease: Lease): void
  drop(lane: ThreadId, lease: Lease): void
} {
  const held = new Map<ThreadId, Lease>()
  return {
    docOf: lane => held.get(lane)?.doc ?? null,
    hold: (lane, lease) => void held.set(lane, lease),
    drop(lane, lease) {
      if (held.get(lane) === lease) held.delete(lane)
    },
  }
}

export interface Runs {
  /**
   * Start one turn on a thread's lane, streaming into the document. A
   * prompt's run reads its pinned cards first, which may wait for their text.
   * Only a lane proven runnable (`LaneWork.runnable`) starts one, so none
   * starts on a lane of another kind, whatever path asks. Only a step starts
   * one: the run leases its lane's root from `roots`, and lets it go once its
   * end has run.
   */
  start(roots: StepDocs, lane: RunnableLane, start: RunStart): RunId
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
  | "split-ended"
  | "run-end-report-pending"
  | "end-run"
  | "lane-stopped"
  | "ended"

/**
 * A run's end, in order, from its prompt's role. A split checks its stack,
 * however it started. A resolution ends as any run does: its outcome is the
 * proposed changes' conflicts and the agent's asks in the tree. The run's
 * end report is pending before `end-run`: written after, a reader would see
 * the lane stopped beside the last run's end report. `end-run` comes before
 * `lane-stopped` and `ended`: it closes the lane's streams, and what follows
 * reads the lane as idle.
 */
export function planRunEnd(role: Role | undefined): readonly RunEndStep[] {
  const outcome: readonly RunEndStep[] = role === "stack" ? ["split-ended"] : []
  return [
    ...outcome,
    "run-end-report-pending",
    "end-run",
    "lane-stopped",
    "ended",
  ]
}

/**
 * The agent's `onStream`: gather the lane's streams from `pinetrie:live` and
 * its tip from its run's root, plan, execute. The documents record what each
 * lane is running and streaming; a second copy here would be two sources of
 * truth.
 */
export const streamInto =
  (basics: Pick<Basics, "live" | "newId">, runs: RunDocs) =>
  (event: StreamEvent): void => {
    const { live, newId } = basics
    const doc = runs.docOf(event.lane)
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
  readonly runDocs: ReturnType<typeof createRunDocs>
  readonly agent: Pick<Agent, "lane">
  readonly work: Pick<LaneWork, "beforeRun" | "runEnded" | "splitEnded">
  readonly readPinned: ReadPinned
  readonly readCanvasContext: ReadCanvasContext
  /** What a chat's run is told first of its base's new work, and forgetting what was steered once the lane stops. */
  readonly baseNews: Pick<BaseNews, "atStart" | "runEnded">
  /** Write `lane`'s run's end report as pending (`Digests.pending`). */
  readonly pending: (lane: ThreadId, prompt: EntryId) => Promise<void>
}): Runs {
  const { basics, agent, work, readPinned, readCanvasContext, baseNews } = deps
  const { live, log, docs } = basics
  const { runDocs } = deps
  let ended: (lane: ThreadId, prompt: EntryId | null) => void = () => {}
  /**
   * A chat's run between its start and pi's, by lane. Only a chat's: a land
   * or stack run cancelled here would write no prompt, and `end` would read
   * the lane's previous one, and could check an old split's stack again.
   */
  const waiting = new Map<ThreadId, AbortController>()

  /**
   * Carry out `planRunEnd`. The steps before `end-run` may fail, and a failure
   * is logged; `end-run` and every step after it always run.
   */
  async function end(lane: ThreadId, id: RunId): Promise<void> {
    const doc = runDocs.docOf(lane)
    const prompt = doc === null ? null : readLatestPrompt(doc, lane)
    const steps = planRunEnd(prompt?.role)
    const cut = steps.indexOf("end-run")
    const carry = async (step: RunEndStep) => {
      switch (step) {
        case "split-ended":
          if (prompt !== null) await work.splitEnded(lane, prompt.id)
          return
        case "run-end-report-pending":
          if (prompt !== null) await deps.pending(lane, prompt.id)
          return
        case "end-run":
          return endRun(live, lane, id)
        case "lane-stopped":
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
    start(roots, lane, start) {
      const root = docs.rootOfLane(lane)
      if (root === null) throw new Error(`${lane} has no root to run in`)
      const lease = roots.lease(root)
      runDocs.hold(lane, lease)
      const id = runId(basics.newId())
      applyLiveOps(live, [{ kind: "begin", lane, run: id }])
      const handle = agent.lane(lane)
      // A chat's message, which is kept if its run never happens.
      const personMessage =
        start.kind === "prompt" && start.message.customType === MESSAGE_TYPE
          ? start.message
          : null
      const stop = new AbortController()
      if (personMessage !== null) waiting.set(lane, stop)
      void (async () => {
        // The step that starts a run has loaded its lane's root, so the
        // lease holds it hydrated: nothing waits before the pinned cards'
        // read, which a stop may cancel at once.
        await using _held = lease
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
          if (personMessage !== null && stop.signal.aborted) {
            log(`[host] run ${id.slice(-8)} stopped before it started`)
            await handle.append(personMessage)
            return
          }
          // A chat's run is told its base's new work first; a resolution or a
          // split has a prompt of its own.
          const behind =
            personMessage === null
              ? null
              : await baseNews.atStart(lane).catch(error => {
                  failed(basics, "the base's news")(error)
                  return null
                })
          // What the run is told of its canvas, read after the pinned cards'
          // wait, so it is as late as the run's start.
          const canvas = await readCanvasContext(lane).catch(error => {
            failed(basics, "the canvas's context")(error)
            return []
          })
          // The cards entry stays the prompt's parent; what an asked agent
          // heard goes first.
          const before = [
            start.incoming ?? null,
            behind,
            ...canvas,
            pinned,
          ].filter(m => m !== null)
          const ran = await handle.run(start.message, before)
          if (ran.kind === "ok" && ran.promptChanged.length > 0)
            log(
              promptChangedLine(
                readThreadName(basics.session, lane),
                ran.promptChanged,
              ),
            )
          if (personMessage !== null && settleRun(ran) === "keep") {
            // The reply was already `started`, so the author cannot be told;
            // at least their message is not lost.
            log(`[host] run ${id.slice(-8)} REFUSED: kept as a message`)
            await handle.append(personMessage)
          }
        } catch (error) {
          failed(basics, "run")(error)
        } finally {
          await end(lane, id)
          runDocs.drop(lane, lease)
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

/**
 * The line a run that wrote its lane's prompt anew logs: the sections of
 * pi's prompt that changed since the lane last had it (`project_context` for
 * `AGENTS.md`, `skills`).
 */
export const promptChangedLine = (
  thread: string,
  sections: readonly string[],
): string =>
  `[host] ${thread}: the model's prompt changed: ${sections.join(", ")}`

/**
 * A run on `lane`, proven runnable first (`LaneWork.runnable`); on a lane of
 * another kind, the refusal instead. The gates before a run (the
 * dispatcher's, the drain's, a relay's reach) refuse it with words first:
 * this is what a path past them would meet.
 */
export function startRun(
  deps: {
    readonly work: Pick<LaneWork, "runnable">
    readonly start: Runs["start"]
  },
  roots: StepDocs,
  lane: ThreadId,
  start: RunStart,
): { readonly kind: "started"; readonly runId: RunId } | Refusal {
  const runnable = deps.work.runnable(lane)
  return typeof runnable === "object"
    ? foreignRefusal(runnable)
    : { kind: "started", runId: deps.start(roots, runnable, start) }
}
