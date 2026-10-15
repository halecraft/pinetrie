// host/answers — what a relayed run sends back, once it has ended: its answer
// to the thread that asked, the answers that waited for an asker's run to
// end, and the round. Each lands after a gap, so each is a late step
// (`later.ts`): planned when it runs, from the documents as they are then.
// An answer for an asker out of reach is the answering thread's
// `undelivered` fact, never a message the asker would get.

import {
  type Away,
  askOutcome,
  type EntryId,
  indexAsks,
  isRoundAnswered,
  lastWord,
  messageAt,
  projectTranscript,
  type QueuedFact,
  type RelayDetails,
  type ThreadId,
  threadMembers,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import { readThreads, readTreeIndex } from "@pinetrie/reads"
import {
  type AnswerMessage,
  type AnswerPlan,
  decodeRelay,
  encodeAnswer,
  planAnswer,
  planDelivery,
  roundReplyOf,
  roundRequest,
  transcriptLines,
} from "@pinetrie/rules"
import { readEntryMessage } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { Budgets } from "./budgets.ts"
import type { Later, LateWrite } from "./later.ts"
import type { Relays } from "./relays.ts"
import type { Runs } from "./runs.ts"
import { threadsNow } from "./threads-now.ts"
import type { LaneWork } from "./work/index.ts"

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
  /** A relay into another thread, gated by both threads' reach when it runs. */
  readonly relays: Pick<Relays, "deliver">
  readonly agent: Pick<Agent, "lane">
  readonly scribe: Pick<Scribe, "appendToTree">
  readonly start: Runs["start"]
  /** Whether a run may start on a lane (`LaneWork.runnable`). */
  readonly runnable: LaneWork["runnable"]
  readonly budgets: Budgets
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
}): Answers {
  const { basics, budgets, later } = deps
  const { docs, session } = basics
  const threads = threadsNow(basics)
  // Answers that wake nobody, for a lane that was running when they came:
  // appended when its run ends, never steered into it, so its agent does
  // not take them as something to answer. Held in memory: a restart drops
  // them, as it drops the run they waited behind.
  const pending = new Map<ThreadId, HeldAnswer[]>()

  /** The answering thread's fact that its answer reached nobody. */
  const undelivered = (
    held: Pick<HeldAnswer, "relay" | "lane">,
    why: Away,
  ): QueuedFact => ({
    kind: "undelivered",
    lane: held.lane,
    to: held.relay.from,
    toName: threads.nameOf(held.relay.from),
    why,
    by: held.relay.by,
  })

  /** What `lane`'s answer to `relay` writes, as `planAnswer` decided it. */
  function answerWrite(
    lane: ThreadId,
    relay: RelayDetails,
    plan: AnswerPlan,
  ): LateWrite {
    switch (plan.kind) {
      case "undelivered":
        return { facts: [undelivered({ relay, lane }, plan.reach)] }
      case "unanswered":
        return {
          facts: [
            {
              kind: "unanswered",
              lane: relay.from,
              member: lane,
              why: plan.why,
              by: relay.by,
            },
          ],
        }
      case "answer":
        return {
          after: () =>
            deliver(
              lane,
              relay,
              encodeAnswer(plan.answer, basics.now()),
              plan.answer.wakes,
            ),
        }
    }
  }

  /** `message` into the asker's thread, as `planDelivery` places it. */
  async function deliver(
    lane: ThreadId,
    relay: RelayDetails,
    message: AnswerMessage,
    wakes: boolean,
  ): Promise<void> {
    const from = await threads.thread(relay.from)
    if (from === null) return
    const to = planDelivery({
      lane: from.lane,
      compelled: wakes,
      mode: "queue",
      race: null,
      steers: wakes,
    })
    switch (to.kind) {
      case "run": {
        // An asker of another kind runs nothing: the answer waits in its
        // thread, as one that wakes nobody does.
        const runnable = deps.runnable(to.thread)
        if (typeof runnable === "object")
          await deps.agent.lane(to.thread).append(message)
        else
          deps.start(runnable, {
            kind: "prompt",
            message,
            pinnedSeen: [],
            heard: null,
          })
        return
      }
      case "steer":
        await deps.agent.lane(to.thread).steer(message)
        return
      case "appendToLane":
        await deps.agent.lane(to.thread).append(message)
        return
      case "appendToTree": {
        const root = readThreads(session).get(relay.from)?.root
        if (root !== undefined && from.end !== null)
          await deps.scribe.appendToTree(
            message,
            { root, at: { kind: "entry", id: from.end } },
            relay.from,
          )
        return
      }
      case "busy":
        // It wakes nobody: it waits for the run to end.
        pending.set(relay.from, [
          ...(pending.get(relay.from) ?? []),
          { message, relay, lane },
        ])
        return
      case "createAndRun":
      case "conflict":
        // An answer never creates a lane, nor races anyone.
        return
    }
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
          const reach = threads.reach(asker)
          return reach.kind === "open"
            ? {
                after: async () => {
                  await deps.agent.lane(asker).append(held.message)
                },
              }
            : { facts: [undelivered(held, reach)] }
        },
      ),
    )
  }

  /** `lane`'s answer to `relay`, the relayed run that `prompt` started. */
  const answer = (lane: ThreadId, prompt: EntryId, relay: RelayDetails) =>
    later.step({ kind: "thread", thread: lane }, "an answer", () => {
      const doc = docs.docOfLane(lane)
      if (doc === null) return null
      const index = readTreeIndex(doc)
      const asks = indexAsks(index)
      const outcome = askOutcome(index, asks, prompt, { running: false })
      const word = lastWord(index, asks, prompt)
      const text = word === null ? "" : (messageAt(index, word)?.text ?? "")
      return answerWrite(
        lane,
        relay,
        planAnswer({
          relay,
          relayEntry: prompt,
          thread: lane,
          name: threads.nameOf(lane),
          end:
            outcome.kind === "stopped"
              ? { kind: "stopped" }
              : outcome.kind === "failed" || text === ""
                ? { kind: "failed" }
                : { kind: "answered", text },
          spent: budgets.spent(relay.budget),
          fromReach: threads.reach(relay.from),
        }),
      )
    })

  /**
   * After every member a person's message asked has answered: when it asked
   * two or more, one request decides what comes next. Gathered first, so a
   * round no one could hear asks nothing.
   */
  async function round(relay: RelayDetails): Promise<void> {
    if (threads.reach(relay.from).kind !== "open") return
    const from = await threads.thread(relay.from)
    if (from === null) return
    const asked = from.index.entries[relay.source]?.message?.asks ?? []
    if (
      asked.length < 2 ||
      !isRoundAnswered(from.index, from.end, relay.source)
    )
      return
    if (budgets.spent(relay.budget)) return
    const skill = await deps.piSetup.skill("pinetrie:skill:agents-round")
    if (skill === null) {
      basics.log("[host] no agents-round skill")
      return
    }
    const members = new Map(
      threadMembers(from.index, from.end).map(
        t => [threads.nameOf(t), t] as const,
      ),
    )
    const request = roundRequest({
      skill: skill.content,
      members: [...members.keys()],
      lines: transcriptLines(projectTranscript(from.index, from.end)),
    })
    await later.outside({
      scope: { kind: "thread", thread: relay.from },
      what: "the round",
      failed: error =>
        basics.log(`[host] the round's request failed: ${error}`),
      request: async () => {
        const { text, tokens } = await deps.piSetup.complete(request)
        budgets.spendFrom(relay.budget, tokens)
        return text
      },
      plan: reply => {
        const next = roundReplyOf(reply, members)
        switch (next.kind) {
          case "people":
            return {
              facts: [
                {
                  kind: "round",
                  lane: relay.from,
                  line: next.line,
                  by: relay.by,
                },
              ],
            }
          case "ask":
            return {
              after: async () => {
                const now = await threads.thread(relay.from)
                if (now === null) return
                await deps.relays.deliver(relay.from, next.thread, {
                  source: now.end ?? relay.source,
                  asker: { kind: "person", writer: relay.by },
                  askerName: threads.personName(relay.by),
                  text: next.text,
                  budget: relay.budget,
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
      // Queued now, before the run's end drains the lane: what waited for
      // the run is appended before anything the drain starts.
      const held = heldAnswers(lane)
      await Promise.all(held)
      if (prompt === null) return
      await budgets.runEnded(prompt)
      const doc = docs.docOfLane(lane)
      // The prompt's entry is written once, so reading it here holds.
      const stored = doc === null ? null : readEntryMessage(doc, prompt)
      const relay =
        stored?.present === true ? decodeRelay(stored.message) : undefined
      if (relay === undefined) return
      await answer(lane, prompt, relay)
      if (relay.asker.kind === "person") await round(relay)
    },
  }
}
