// host/answers — what a relayed run sends back, once it has ended: its answer
// to the thread that asked, the answers that waited for an asker's run to
// end, and the round. Each lands after a gap, so each is a late step
// (`later.ts`): planned when it runs, from the documents as they are then.
// An answer for an asker out of reach is the answering thread's
// `undelivered` fact, never a message the asker would get. Where an answer
// goes in its asker's thread is `delivery.ts`'.

import {
  type Away,
  askOutcome,
  type EntryId,
  entryMessage,
  indexAsks,
  isRoundAnswered,
  lastWord,
  projectTranscript,
  type QueuedFact,
  type RelayDetails,
  type ThreadId,
  threadMembers,
} from "@pinetrie/core"
import type { Agent, PiSetup } from "@pinetrie/pi"
import { readTreeIndex } from "@pinetrie/reads"
import {
  type AnswerMessage,
  type AnswerPlan,
  decodeRelay,
  encodeAnswer,
  parseRoundReply,
  planAnswer,
  roundRequest,
  transcriptLines,
} from "@pinetrie/rules"
import { readEntryMessage } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "./basics.ts"
import type { Budgets } from "./budgets.ts"
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
  readonly budgets: Budgets
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
}): Answers {
  const { basics, budgets, later } = deps
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
    later.step({ kind: "thread", thread: lane }, "an answer", async roots => {
      const doc = (await roots.lane(lane))?.doc
      if (doc === undefined) return null
      const index = readTreeIndex(doc)
      const asks = indexAsks(index)
      const outcome = askOutcome(index, asks, prompt, { running: false })
      const word = lastWord(index, asks, prompt)
      const text = word === null ? "" : (entryMessage(index, word)?.text ?? "")
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
    const from = await deps.keeper.run(roots =>
      threads.thread(roots, relay.from),
    )
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
        const next = parseRoundReply(reply, members)
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
              after: async roots => {
                const now = await threads.thread(roots, relay.from)
                if (now === null) return
                await deps.relays.deliver(roots, relay.from, next.thread, {
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
      await budgets.runEnded(prompt)
      const relay =
        stored?.present === true ? decodeRelay(stored.message) : undefined
      if (relay === undefined) return
      await answer(lane, prompt, relay)
      if (relay.asker.kind === "person") await round(relay)
    },
  }
}
