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
  type RunId,
  type RunnableLane,
  runId,
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
  planAfterStep,
  planEndRun,
  planRunSteps,
  planStream,
  type StepOutcome,
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
import type { Role, SentCard, StreamEvent } from "@pinetrie/threads"
import type { BaseNews } from "./base-news.ts"
import { type Basics, failed, notWritten } from "./basics.ts"
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
   * Stop a chat's run before its prompt reaches pi; its message is kept,
   * unrun. True while it waits for its pinned cards' text, where pi's
   * `abort` reaches nothing. While it resumes the operation the last host
   * left open, its message is kept all the same, but the resume is pi's to
   * stop, so this returns false and the caller asks pi to abort. False when
   * no chat's run waits on `lane`.
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
  | "left-running"
  | "lane-stopped"
  | "ended"

/**
 * A run's end, from its prompt's role and whether pi's harness closed under
 * it. `failable` may fail, which is logged; `always` runs whatever came
 * before. A split checks its stack, however it started. A resolution ends
 * as any run does: its outcome is the proposed changes' conflicts and the
 * agent's asks in the tree. The run's end report is pending before
 * `end-run`: written after, a reader would see the lane stopped beside the
 * last run's end report. `end-run` comes before `lane-stopped` and `ended`:
 * it closes the lane's streams, and what follows reads the lane as idle. An
 * interrupted run leaves its lane marked running instead: pi keeps its
 * operation open, and the next host opens the lanes marked running and
 * resumes them.
 */
export function planRunEnd(input: {
  readonly role: Role | undefined
  readonly interrupted: boolean
}): {
  readonly failable: readonly RunEndStep[]
  readonly always: readonly RunEndStep[]
} {
  const outcome: readonly RunEndStep[] =
    input.role === "stack" ? ["split-ended"] : []
  return {
    failable: [...outcome, "run-end-report-pending"],
    always: [
      input.interrupted ? "left-running" : "end-run",
      "lane-stopped",
      "ended",
    ],
  }
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

/**
 * A chat's run a Stop can still keep unrun: `pinned` while it gathers and
 * waits for its pinned cards, where pi's `abort` reaches nothing; `resuming`
 * while it resumes an operation the last host left open, which only pi's
 * abort ends.
 */
interface Stoppable {
  readonly stop: AbortController
  phase: "pinned" | "resuming"
}

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
   * Each chat's run a Stop can still keep unrun, by lane, until its prompt
   * reaches pi. Only a chat's: a land or stack run cancelled here would
   * write no prompt, and `end` would read the lane's previous one, and could
   * check an old split's stack again.
   */
  const stoppable = new Map<ThreadId, Stoppable>()

  /**
   * Carry out `planRunEnd`. Its `failable` steps may fail, and a failure is
   * logged; its `always` steps run whatever came before.
   */
  async function end(
    lane: ThreadId,
    id: RunId,
    interrupted: boolean,
  ): Promise<void> {
    const doc = runDocs.docOf(lane)
    const prompt = doc === null ? null : readLatestPrompt(doc, lane)
    const steps = planRunEnd({ role: prompt?.role, interrupted })
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
        case "left-running":
          log(`[host] run ${id.slice(-8)} left running for the next start`)
          return
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
      for (const step of steps.failable) await carry(step)
    } catch (error) {
      failed(basics, "run end")(error)
    }
    for (const step of steps.always) await carry(step)
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
      const name = () => readThreadName(basics.session, lane)
      // A chat's message, which is kept if its run never happens.
      const personMessage =
        start.kind === "prompt" && start.message.customType === MESSAGE_TYPE
          ? start.message
          : null
      const stop = new AbortController()
      const stopping: Stoppable | null =
        personMessage === null ? null : { stop, phase: "pinned" }
      if (stopping !== null) stoppable.set(lane, stopping)
      const leave = () => {
        if (stoppable.get(lane) === stopping) stoppable.delete(lane)
      }

      /** The prompt: its pinned cards, then what it is told, then pi's run. */
      const prompted = async (
        prompt: Extract<RunStart, { kind: "prompt" }>,
      ): Promise<StepOutcome> => {
        if (stopping !== null) stopping.phase = "pinned"
        // A Stop may come while the lane's state is gathered, before this wait.
        if (stop.signal.aborted) return "stopped"
        const pinned = await readPinned(
          lane,
          prompt.pinnedSeen,
          stop.signal,
        ).catch(error => {
          failed(basics, "pinned cards")(error)
          return null
        })
        leave()
        if (stop.signal.aborted) return "stopped"
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
          prompt.incoming ?? null,
          behind,
          ...canvas,
          pinned,
        ].filter(m => m !== null)
        const ran = await handle.run(prompt.message, before)
        if (ran.kind === "ok" && ran.promptChanged.length > 0)
          log(promptChangedLine(name(), ran.promptChanged))
        return ran.kind
      }

      /**
       * pi's resume of the lane's open operation. It runs even after a Stop:
       * until it ends, pi would refuse the kept message as busy. A Stop
       * during it is pi's abort, which ends the operation; the prompt's
       * step then sees the Stop, and keeps the message.
       */
      const resumed = async (): Promise<StepOutcome> => {
        if (stopping !== null) stopping.phase = "resuming"
        return (await handle.resume()).kind
      }

      void (async () => {
        // The step that starts a run has loaded its lane's root, so the
        // lease holds it hydrated.
        await using _held = lease
        let interrupted = false
        try {
          work.beforeRun(lane)
          // gather
          const leftOpen =
            start.kind === "prompt" && (await handle.isLeftOpen())
          // plan
          const steps = planRunSteps(start, leftOpen)
          // execute
          if (steps.length > 1) log(resumingLine(name(), "before-message"))
          for (const step of steps) {
            const outcome =
              step.kind === "resume" ? await resumed() : await prompted(step)
            if (outcome === "interrupted") interrupted = true
            const next = planAfterStep({
              step: step.kind,
              outcome,
              chat: personMessage !== null,
            })
            if (next === "keep" && personMessage !== null) {
              // The reply was already `started`, so the author cannot be
              // told; at least their message is not lost.
              log(keptLine(id, outcome))
              notWritten(
                basics,
                "a kept message",
                lane,
              )(await handle.append(personMessage))
            }
            if (next !== "continue") break
          }
        } catch (error) {
          failed(basics, "run")(error)
        } finally {
          leave()
          await end(lane, id, interrupted)
          runDocs.drop(lane, lease)
        }
      })()
      return id
    },
    cancel(lane) {
      const stopping = stoppable.get(lane)
      if (stopping === undefined) return false
      stopping.stop.abort()
      if (stopping.phase === "resuming") return false
      stoppable.delete(lane)
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
 * The line a resume of an operation the last host left open logs, whether a
 * crash or a stop cut it off; `before-message` when a new message's run
 * resumes it first.
 */
export const resumingLine = (
  thread: string,
  then: "alone" | "before-message",
): string =>
  `[host] resuming ${thread}, which the last host left running${then === "before-message" ? ", before its new message" : ""}`

/** The line a chat's run logs as it keeps the message unrun: pi refused it, or a Stop came first. */
export const keptLine = (run: RunId, outcome: StepOutcome): string =>
  `[host] run ${run.slice(-8)} ${outcome === "refused" ? "REFUSED: kept as a message" : "stopped before it started"}`

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
