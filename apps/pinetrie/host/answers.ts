// host/answers — what a relayed run sends back, once it has ended: its answer
// to the thread that asked, the answers that waited for an asker's run to
// end, and the round. Each lands after a gap, so each is a late step
// (`later.ts`): planned when it runs, from the documents as they are then.
// An answer for an asker out of reach is the answering thread's
// `undelivered` fact, never a message the asker would get. Where an answer
// goes in its asker's thread is `delivery.ts`'.

import type { EntryId, ThreadId } from "@pinetrie/core"
import type { Agent, PiSetup } from "@pinetrie/pi"
import { readNames, readTreeIndex } from "@pinetrie/reads"
import {
  type AnswerMessage,
  decodeRelay,
  encodeAnswer,
  planHeldAnswer,
  planRelayAnswer,
  planRoundAsk,
  planRoundNext,
  type RelayAnswer,
  roundRequest,
} from "@pinetrie/rules"
import { readEntryMessage } from "@pinetrie/schema"
import type { RelayDetails } from "@pinetrie/threads"
import type { Allowances } from "./allowances.ts"
import { type Basics, type HostKeeper, notWritten } from "./basics.ts"
import type { Deliver } from "./delivery.ts"
import type { Later, LateWrite } from "./later.ts"
import type { Relays } from "./relays.ts"
import type { StepDocs } from "./roots.ts"
import type { RunDocs } from "./runs.ts"
import { threadsNow } from "./threads-now.ts"

export interface Answers {
  /**
   * `lane`'s run ended with `prompt`: the answers held for it, then its own
   * answer when it was a relay, then the round. Its first steps are queued
   * before it returns its first await, so they go before the run's end's
   * drain.
   */
  ended(lane: ThreadId, prompt: EntryId | null): Promise<void>
}

/** An answer that waited for its asker's run to end. */
interface HeldAnswer {
  readonly message: AnswerMessage
  readonly relay: RelayDetails
  /** The thread that answered. */
  readonly lane: ThreadId
}

export function createAnswers(deps: {
  readonly basics: Pick<
    Basics,
    "docs" | "session" | "places" | "live" | "now" | "log"
  >
  readonly later: Later
  /** A round's gather reads its asker's thread in a step of its own. */
  readonly keeper: Pick<HostKeeper, "run">
  /** A run's prompt is read at its end, while its lease holds its root. */
  readonly runs: RunDocs
  /** A relay into another thread, gated by both threads' reach when it runs. */
  readonly relays: Pick<Relays, "deliver">
  readonly agent: Pick<Agent, "lane">
  /** Where an answer goes in its asker's thread (`delivery.ts`). */
  readonly deliver: Deliver
  readonly allowances: Allowances
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
}): Answers {
  const { basics, allowances, later } = deps
  const threads = threadsNow(basics)
  // Answers that wake nobody, for a lane that was running when they came:
  // appended when its run ends, never steered into it, so its agent does
  // not take them as something to answer. Held in memory: a restart drops
  // them, as it drops the run they waited behind.
  const pending = new Map<ThreadId, HeldAnswer[]>()

  /** What `lane`'s answer to `relay` writes, as `planRelayAnswer` decided it. */
  function answerWrite(
    lane: ThreadId,
    relay: RelayDetails,
    plan: RelayAnswer,
  ): LateWrite {
    switch (plan.kind) {
      case "facts":
        return { facts: plan.facts }
      case "answer":
        return {
          after: roots =>
            deliver(
              roots,
              lane,
              relay,
              encodeAnswer(plan.answer, basics.now()),
              plan.answer.wakes,
            ),
        }
    }
  }

  /** `message` into the asker's thread; one that must wait for its run's end is held. */
  async function deliver(
    roots: StepDocs,
    lane: ThreadId,
    relay: RelayDetails,
    message: AnswerMessage,
    wakes: boolean,
  ): Promise<void> {
    const placed = await deps.deliver(
      roots,
      relay.from,
      wakes ? { wakes: true, message } : { wakes: false, message },
      wakes,
    )
    // It wakes nobody: it waits for the run to end.
    if (placed === "busy")
      pending.set(relay.from, [
        ...(pending.get(relay.from) ?? []),
        { message, relay, lane },
      ])
  }

  /** Each answer held for `asker`, appended, or its answerer told it reached nobody. */
  const heldAnswers = (asker: ThreadId): Promise<void>[] => {
    const waiting = pending.get(asker) ?? []
    pending.delete(asker)
    return waiting.map(held =>
      later.step(
        { kind: "thread", thread: held.lane },
        "an answer held for its asker's run",
        () => {
          const plan = planHeldAnswer({
            lane: held.lane,
            relay: held.relay,
            askerReach: threads.reach(asker),
            askerName: threads.nameOf(asker),
          })
          return plan.kind === "facts"
            ? { facts: plan.facts }
            : {
                after: async () => {
                  notWritten(
                    basics,
                    "an answer",
                    asker,
                  )(await deps.agent.lane(asker).append(held.message))
                },
              }
        },
      ),
    )
  }

  /** `lane`'s answer to `relay`, the relayed run that `prompt` started. */
  const answer = (lane: ThreadId, prompt: EntryId, relay: RelayDetails) =>
    later.step({ kind: "thread", thread: lane }, "an answer", async roots => {
      const doc = (await roots.lane(lane))?.doc
      if (doc === undefined) return null
      return answerWrite(
        lane,
        relay,
        planRelayAnswer({
          relay,
          prompt,
          thread: lane,
          name: threads.nameOf(lane),
          index: readTreeIndex(doc),
          spent: allowances.spent(relay.allowance),
          fromReach: threads.reach(relay.from),
          fromName: threads.nameOf(relay.from),
        }),
      )
    })

  /**
   * After every member a person's message asked has answered: when it asked
   * two or more, one request decides what comes next. Gathered first, so a
   * round no one could hear asks nothing.
   */
  async function round(relay: RelayDetails): Promise<void> {
    const asking = await deps.keeper.run(roots =>
      threads.thread(roots, relay.from),
    )
    const ask = planRoundAsk({
      relay,
      asking,
      reach: threads.reach(relay.from),
      spent: allowances.spent(relay.allowance),
      names: readNames(basics.session),
    })
    if (ask === null) return
    const skill = await deps.piSetup.skill("pinetrie:skill:agents-round")
    if (skill === null) {
      basics.log("[host] no agents-round skill")
      return
    }
    const request = roundRequest({
      skill: skill.content,
      members: [...ask.members.keys()],
      lines: ask.lines,
    })
    await later.outside({
      scope: { kind: "thread", thread: relay.from },
      what: "the round",
      failed: error =>
        basics.log(`[host] the round's request failed: ${error}`),
      request: async () => {
        const { text, tokens } = await deps.piSetup.complete(request)
        allowances.spendFrom(relay.allowance, tokens)
        return text
      },
      plan: reply => {
        const next = planRoundNext({ reply, round: ask, relay })
        switch (next.kind) {
          case "facts":
            return { facts: next.facts }
          case "ask":
            return {
              after: async roots => {
                const now = await threads.thread(roots, relay.from)
                if (now === null) return
                await deps.relays.deliver(roots, relay.from, next.thread, {
                  source: now.end ?? relay.source,
                  asker: { kind: "person", writer: relay.by },
                  askerName: threads.personName(relay.by),
                  text: next.text,
                  allowance: relay.allowance,
                  by: relay.by,
                })
              },
            }
          case "nothing":
            return null
        }
      },
    })
  }

  return {
    async ended(lane, prompt) {
      // Read before the first await, while the run's lease holds its root:
      // the prompt's entry is written once, so reading it now holds.
      const doc = deps.runs.docOf(lane)
      const stored =
        doc === null || prompt === null ? null : readEntryMessage(doc, prompt)
      // Queued now, before the run's end drains the lane: what waited for
      // the run is appended before anything the drain starts.
      const held = heldAnswers(lane)
      await Promise.all(held)
      if (prompt === null) return
      await allowances.runEnded(prompt)
      const relay =
        stored?.present === true ? decodeRelay(stored.message) : undefined
      if (relay === undefined) return
      await answer(lane, prompt, relay)
      if (relay.asker.kind === "person") await round(relay)
    },
  }
}
