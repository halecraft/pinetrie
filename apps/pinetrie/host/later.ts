// host/later — the host's own writes that land after a gap: a model request's
// answer, a step a run's end queues, an offer action's fact. Each is planned
// when its step runs, behind the archive's gate for late writes (`lateAway`),
// and its writes are values this module carries out, so a module whose work
// is late needs no write port of its own.

import type { Away, QueuedFact, ThreadId, ValueWrite } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import {
  readArchived,
  readParticipantNames,
  readPlaces,
  readThreadName,
  readThreads,
} from "@pinetrie/reads"
import {
  awayWords,
  displayName,
  type LateScope,
  lateAway,
} from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import { queueFact } from "./facts.ts"
import type { Places } from "./places.ts"
import type { Records } from "./records.ts"

/**
 * What a late step writes, once its gate has let it through: records, facts
 * (each gated again on its own lane), and `after`, a write whose own rule
 * gates it in the same step (a relay, which `planRelay` refuses for a thread
 * out of reach; an answer's delivery, which `planAnswer` makes `undelivered`
 * for an asker out of reach). Not `then`: a plan returns this from an async
 * function, and a value with a `then` method is awaited as a promise.
 */
export interface LateWrite {
  readonly records?: readonly ValueWrite[]
  readonly facts?: readonly QueuedFact[]
  readonly after?: () => Promise<void>
}

export interface Later {
  /**
   * Queue one step on the keeper, at once: a caller that orders its step
   * before another's by queueing first (an answer before the run's end's
   * drain) keeps that order. In the step: the gate, then `plan`, which reads
   * the documents as they are now (`docs.view`, or `threadsNow`, which opens
   * only a live thread's root; never a handle read before the gap) and
   * returns what to write, or null.
   */
  step(
    scope: LateScope,
    what: string,
    plan: () => LateWrite | null | Promise<LateWrite | null>,
  ): Promise<void>
  /**
   * A model request outside the keeper, tracked so `quiet` waits for it, then
   * a `step` with its answer; a null answer writes nothing. With `held`, its
   * key is in the set while the request is out. A failure goes to `failed`.
   */
  outside<R, K = never>(input: {
    readonly scope: LateScope
    readonly what: string
    readonly request: () => Promise<R | null>
    readonly plan: (answer: R) => LateWrite | null | Promise<LateWrite | null>
    readonly failed: (error: unknown) => void
    readonly held?: { readonly set: Set<K>; readonly key: K }
  }): Promise<void>
}

/** Why `scope` takes no late write now (`lateAway`), from the session and the places. */
export const lateAwayNow = (
  basics: Pick<Basics, "session" | "places">,
  scope: LateScope,
): Away | null =>
  lateAway(scope, {
    cards: readPlaces(basics.places),
    archived: readArchived(basics.session, basics.places),
    opened: readThreads(basics.session),
  })

export function createLater(deps: {
  readonly basics: Pick<Basics, "session" | "places" | "log" | "newId">
  readonly keeper: Pick<Keeper, "run" | "track">
  readonly records: Pick<Records, "writeValues">
  readonly placesWriter: Places
  /** Ask for a lane's drain: a fact queued on an idle lane is appended so. */
  readonly drain: (lane: ThreadId) => void
}): Later {
  const { basics, keeper } = deps
  const { session, log } = basics

  /** Why `scope` takes no late write now, worded for the log, or null. */
  function refusal(scope: LateScope, what: string): string | null {
    const away = lateAwayNow(basics, scope)
    if (away === null) return null
    const why = awayWords(away, w =>
      displayName(w, readParticipantNames(session).get(w)),
    )
    const where =
      scope.kind === "thread"
        ? `${readThreadName(session, scope.thread)}: `
        : ""
    return `[host] ${where}${what} not written: ${why}`
  }

  async function execute(write: LateWrite): Promise<void> {
    if (write.records !== undefined && write.records.length > 0)
      await deps.records.writeValues(write.records)
    for (const fact of write.facts ?? []) {
      const refused = refusal(
        { kind: "thread", thread: fact.lane },
        `a ${fact.kind} fact`,
      )
      if (refused === null) await queueFact(deps, fact)
      else log(refused)
    }
    await write.after?.()
  }

  const step: Later["step"] = (scope, what, plan) =>
    keeper.run(async () => {
      const refused = refusal(scope, what)
      if (refused !== null) {
        log(refused)
        return
      }
      const write = await plan()
      if (write !== null) await execute(write)
    })

  return {
    step,
    outside(input) {
      const { held } = input
      held?.set.add(held.key)
      return keeper.track(
        (async () => {
          try {
            const answer = await input.request()
            if (answer !== null)
              await step(input.scope, input.what, () => input.plan(answer))
          } catch (error) {
            input.failed(error)
          } finally {
            held?.set.delete(held.key)
          }
        })(),
      )
    },
  }
}
