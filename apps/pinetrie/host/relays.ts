// host/relays — another thread's agent asked, and its answer (ADR-0128).
//
// An ask, a person's (`relayChat`) or an agent's (`ask`, its tool's hook),
// is relayed into the asked thread: what it has not heard of the asking
// thread first, then the ask as its run's prompt; a busy agent gets an ask
// card instead, which its drain relays (`relayCard`). A relayed run's end
// sends its last message back as the answer (`ended`): run in the asker's
// lane when an agent asked and it is idle, steered into it while it runs,
// else appended. When every member a person's message asked has answered,
// one request decides what comes next (the round). Each step gathers, plans
// with `@pinetrie/rules` (`planRelay`, `planAnswer`, `planDelivery`,
// `roundReplyOf`) and then writes, in one keeper step. Where both threads
// are (`threadReach`) is gathered first, from the session and the places,
// and a thread out of reach is refused before any root is opened.

import {
  askOutcome,
  cardIdOfKind,
  type EntryId,
  indexAsks,
  isRoundAnswered,
  laneOf,
  lastHeardEntry,
  lastInvitation,
  lastWord,
  messageAt,
  messageText,
  projectTranscript,
  type QueuedFact,
  type Reach,
  type RelayDetails,
  type ThreadId,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  threadEnd,
  threadMembers,
  type WriterId,
} from "@pinetrie/core"
import type { Agent, PiSetup, Scribe } from "@pinetrie/pi"
import {
  readArchived,
  readLanes,
  readNames,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  type AnswerMessage,
  type AnswerPlan,
  decodeRelay,
  displayName,
  encodeAnswer,
  encodeHeard,
  encodeRelayMessage,
  NONE_BLANK,
  planAnswer,
  planAskCard,
  planDelivery,
  planFactCard,
  planRelay,
  type RelayRefusal,
  reachableAgents,
  relayRefusalText,
  roundReplyOf,
  roundRequest,
  type ToolAnswer,
  threadReach,
  transcriptLines,
  unreachableRefusal,
} from "@pinetrie/rules"
import { readEntryMessage, readLaneTip } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "./basics.ts"
import type { Budgets } from "./budgets.ts"
import { requestOutside } from "./outside.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Runs } from "./runs.ts"
import { tasksNow } from "./tasks.ts"

/** A tool's answer that is no merge: text alone. */
const said = (text: string, isError = false): ToolAnswer => ({
  text,
  isError,
  details: null,
})

/**
 * Every named thread on an open task's canvas (ADR-0128): whose agents a
 * message may name, wherever it is sent. `agentCandidates` leaves its own
 * thread out.
 */
export function readReachableAgents(
  docs: Pick<Basics, "places" | "session">,
): readonly { readonly thread: ThreadId; readonly name: ThreadName }[] {
  return reachableAgents({
    canvases: tasksNow(docs).canvases,
    archived: readArchived(docs.session),
    names: readNames(docs.session),
  })
}

export interface Relays {
  /** `ask` was called in `lane`'s run: relay it to the thread named `to`. */
  ask(lane: ThreadId, to: string, text: string): Promise<ToolAnswer>
  /** `leave` was called in `lane`'s run: leave the thread named `thread`. */
  leave(lane: ThreadId, thread: string): Promise<ToolAnswer>
  /** A person's chat, sent with `sendId` in `thread`, asked or invited members. */
  relayChat(thread: ThreadId, sendId: string): Promise<void>
  /** An ask card popped on `lane`: relay it now. */
  relayCard(lane: ThreadId, relay: RelayDetails): Promise<"ran" | "next">
  /** `lane`'s run ended with `prompt`: an answer, when it was a relay. */
  ended(lane: ThreadId, prompt: EntryId | null): Promise<void>
}

/** What a thread is, read now: its root's index, its end, and its lane. */
interface ThreadNow {
  readonly thread: ThreadId
  readonly index: TreeIndex
  readonly end: EntryId | null
  readonly lane: ThreadLane
}

export function createRelays(deps: {
  readonly basics: Pick<
    Basics,
    "docs" | "session" | "places" | "live" | "now" | "newId" | "log"
  >
  readonly keeper: Pick<HostKeeper, "run" | "track">
  readonly agent: Pick<Agent, "lane">
  readonly scribe: Pick<Scribe, "appendToTree">
  readonly start: Runs["start"]
  readonly budgets: Budgets
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
  /** Ask for a lane's drain. */
  readonly drain: (lane: ThreadId) => void
}): Relays {
  const { basics, budgets } = deps
  const { docs, session, places, live } = basics
  // Answers that wake nobody, for a lane that was running when they came:
  // appended when its run ends, never steered into it, so its agent does
  // not take them as something to answer. Held in memory: a restart drops
  // them, as it drops the run they waited behind.
  const pending = new Map<ThreadId, AnswerMessage[]>()

  const nameOf = (thread: ThreadId): string =>
    readNames(session).get(thread) ?? thread.slice(-8)
  const personName = (w: WriterId): string =>
    displayName(w, readParticipantNames(session).get(w))

  /** `thread` as it is now; null for a thread no root holds. */
  async function threadNow(thread: ThreadId): Promise<ThreadNow | null> {
    const root = readThreads(session).get(thread)?.root
    if (root === undefined) return null
    const doc = await docs.root(root)
    const index = readTreeIndex(doc)
    const lanes = readLanes(
      { doc, live },
      index,
      readPlaces(places),
      readQueueHolds(session),
      NONE_BLANK,
    )
    const lane = laneOf(lanes, thread)
    const end =
      lane.kind === "lane"
        ? (readLaneTip(doc, thread) ?? null)
        : threadEnd(index, thread)
    return { thread, index, end, lane }
  }

  /** Where `thread` is now, from the session and the places: no root is opened. */
  const reachNow = (thread: ThreadId): Reach =>
    threadReach(thread, {
      cards: readPlaces(places),
      archived: readArchived(session),
    })

  /** Both threads of an ask, named, and where each is: gathered once, before any root is opened. */
  const bothReaches = (from: ThreadId, to: ThreadId) => ({
    fromName: nameOf(from),
    fromReach: reachNow(from),
    toName: nameOf(to),
    toReach: reachNow(to),
  })

  /**
   * Relay `relay` into `to`, from `from`: gather both threads' reach and
   * refuse one out of reach before either root is opened (an archived one
   * stays unloaded); then gather both threads, plan with `planRelay`, and
   * run it there, or queue it as an ask card while the agent is busy. `end`
   * is where the asking thread's path ends, when not at its end now. Inside
   * a keeper step.
   */
  async function deliverRelay(
    fromThread: ThreadId,
    to: ThreadId,
    relay: Omit<RelayDetails, "from" | "fromName">,
    end?: EntryId,
  ): Promise<
    | { readonly kind: "ran" }
    | { readonly kind: "queued"; readonly held: boolean }
    | { readonly kind: "refused"; readonly why: RelayRefusal }
  > {
    const reaches = bothReaches(fromThread, to)
    const away = unreachableRefusal(reaches)
    if (away !== null) return { kind: "refused", why: away }
    const now = await threadNow(fromThread)
    if (now === null)
      return {
        kind: "refused",
        why: { kind: "unknown", name: nameOf(fromThread) },
      }
    const from: ThreadNow = end === undefined ? now : { ...now, end }
    const target = await threadNow(to)
    const planned = planRelay({
      ...reaches,
      from: from.thread,
      to,
      members: threadMembers(from.index, from.end),
      toLane: target?.lane ?? { kind: "none" },
      path: projectTranscript(from.index, from.end),
      heard:
        target === null
          ? null
          : lastHeardEntry(target.index, target.end, from.thread),
      lastInvitation: lastInvitation(from.index, from.end, to),
      source: relay.source,
      asker: relay.asker,
      askerName: relay.askerName,
      text: relay.text,
      budget: relay.budget,
      spent: budgets.spent(relay.budget),
      by: relay.by,
    })
    if (planned.kind === "refused") return planned
    const lane = target?.lane ?? { kind: "none" }
    const to_ = planDelivery({
      lane,
      compelled: true,
      mode: "queue",
      race: null,
      steers: false,
    })
    if (to_.kind === "run") {
      const now = basics.now()
      deps.start(to, {
        kind: "prompt",
        message: encodeRelayMessage(planned.relay, now),
        pinnedSeen: [],
        heard:
          planned.heard === null
            ? null
            : encodeHeard(planned.heard.details, planned.heard.lines, now),
      })
      return { kind: "ran" }
    }
    const card = planAskCard({
      cards: readPlaces(places),
      id: cardIdOfKind("ask", basics.newId()),
      lane: to,
      relay: planned.relay,
    })
    if (card !== null) applyPlaceSteps(places, [card])
    deps.drain(to)
    return {
      kind: "queued",
      held: lane.kind === "lane" && lane.heldBy !== null,
    }
  }

  /** A fact for `thread`, queued as every fact is, and its drain asked for. */
  function queueFact(fact: QueuedFact): void {
    const steps = planFactCard({
      cards: readPlaces(places),
      id: cardIdOfKind("fact", basics.newId()),
      fact,
    })
    if (steps !== null) applyPlaceSteps(places, steps)
    deps.drain(fact.lane)
  }

  /** The thread named `name`, anywhere in the session, or null. */
  const findAgent = (name: string) => {
    const wanted = name.toLowerCase()
    for (const [thread, n] of readNames(session))
      if (n === wanted) return { thread, name: n }
    return null
  }

  /** A refusal, in the words its asker reads. */
  const refusal = (why: RelayRefusal): string =>
    relayRefusalText(why, personName)

  async function ask(
    lane: ThreadId,
    to: string,
    text: string,
  ): Promise<ToolAnswer> {
    return deps.keeper.run(async () => {
      const from = await threadNow(lane)
      const target = findAgent(to)
      const budget = budgets.runBudget(lane)
      if (from === null || budget === null)
        return said("This call reached no thread.", true)
      if (target === null)
        return said(refusal({ kind: "unknown", name: to }), true)
      // A person's message whose run asks sets its budget now (ADR-0128).
      const by = budget.by
      if (by === null) return said("This call reached no thread.", true)
      await budgets.ensure(budget.key, lane, by)
      const delivered = await deliverRelay(lane, target.thread, {
        source: from.end ?? budget.key,
        asker: { kind: "agent", thread: lane },
        askerName: nameOf(lane),
        text,
        budget: budget.key,
        by,
      })
      switch (delivered.kind) {
        case "refused":
          return said(refusal(delivered.why), true)
        case "ran":
          return said(
            `Asked ${target.name}. Its answer will come as a message; this call does not wait for it.`,
          )
        case "queued":
          return said(
            delivered.held
              ? `${target.name}'s queue is held: the ask waits there until a person releases it.`
              : `${target.name} is busy: the ask is queued there, and its answer will come as a message.`,
          )
      }
    })
  }

  async function leave(lane: ThreadId, name: string): Promise<ToolAnswer> {
    return deps.keeper.run(async () => {
      const left = findAgent(name)
      const by = budgets.runBudget(lane)?.by ?? null
      if (left === null || by === null)
        return said(refusal({ kind: "unknown", name }), true)
      // A thread out of reach is told nothing, and its root is not opened.
      const away = unreachableRefusal(bothReaches(lane, left.thread))
      if (away !== null) return said(refusal(away), true)
      const there = await threadNow(left.thread)
      if (there === null) return said(refusal({ kind: "unknown", name }), true)
      if (!threadMembers(there.index, there.end).includes(lane))
        return said(`You are not a member of ${left.name}.`, true)
      queueFact({
        kind: "left",
        lane: left.thread,
        member: lane,
        by,
      })
      return said(`You left ${left.name}: you are no longer asked there.`)
    })
  }

  async function relayChat(thread: ThreadId, sendId: string): Promise<void> {
    await deps.keeper.run(async () => {
      const from = await threadNow(thread)
      if (from === null) return
      const source = from.index.bySend.get(sendId)
      const chat =
        source === undefined ? undefined : from.index.entries[source]?.message
      const author = chat?.writer
      if (source === undefined || chat === undefined || author === undefined)
        return
      const asks = chat.asks ?? []
      if (asks.length === 0 && (chat.invites ?? []).length === 0) return
      await budgets.ensure(source, thread, author)
      // What came after the chat is not heard with it: its path ends there.
      for (const to of asks) {
        const delivered = await deliverRelay(
          thread,
          to,
          {
            source,
            asker: { kind: "person", writer: author },
            askerName: chat.author ?? "",
            text: messageText(chat),
            budget: source,
            by: author,
          },
          source,
        )
        if (delivered.kind === "refused")
          basics.log(
            `[host] ${nameOf(to)} was not asked: ${refusal(delivered.why)}`,
          )
      }
    })
  }

  async function relayCard(
    lane: ThreadId,
    relay: RelayDetails,
  ): Promise<"ran" | "next"> {
    const delivered = await deliverRelay(relay.from, lane, relay)
    if (delivered.kind === "refused")
      basics.log(
        `[host] an ask for ${nameOf(lane)} was dropped: ${refusal(delivered.why)}`,
      )
    return delivered.kind === "ran" ? "ran" : "next"
  }

  /** `relay`'s run on `lane` ended with `plan`: sent back to where it was asked. */
  async function sendAnswer(
    lane: ThreadId,
    relay: RelayDetails,
    plan: AnswerPlan,
  ): Promise<void> {
    if (plan.kind === "undelivered") {
      queueFact({
        kind: "undelivered",
        lane,
        to: relay.from,
        toName: nameOf(relay.from),
        why: plan.reach,
        by: relay.by,
      })
      return
    }
    if (plan.kind === "unanswered") {
      queueFact({
        kind: "unanswered",
        lane: relay.from,
        member: lane,
        why: plan.why,
        by: relay.by,
      })
      return
    }
    const from = await threadNow(relay.from)
    if (from === null) return
    const message = encodeAnswer(plan.answer, basics.now())
    const to = planDelivery({
      lane: from.lane,
      compelled: plan.answer.wakes,
      mode: "queue",
      race: null,
      steers: plan.answer.wakes,
    })
    switch (to.kind) {
      case "run":
        deps.start(to.thread, {
          kind: "prompt",
          message,
          pinnedSeen: [],
          heard: null,
        })
        return
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
        pending.set(relay.from, [...(pending.get(relay.from) ?? []), message])
        return
      case "createAndRun":
      case "conflict":
        // An answer never creates a lane, nor races anyone.
        return
    }
  }

  async function ended(lane: ThreadId, prompt: EntryId | null): Promise<void> {
    // Queued now, before the run's end drains the lane: what waited for the
    // run is appended before anything the drain starts.
    const waiting = pending.get(lane) ?? []
    pending.delete(lane)
    if (waiting.length > 0)
      await deps.keeper.run(async () => {
        for (const message of waiting)
          await deps.agent.lane(lane).append(message)
      })
    if (prompt === null) return
    await budgets.runEnded(prompt)
    const doc = docs.docOfLane(lane)
    if (doc === null) return
    const stored = readEntryMessage(doc, prompt)
    const relay = stored.present ? decodeRelay(stored.message) : undefined
    if (relay === undefined) return
    await deps.keeper.run(async () => {
      const index = readTreeIndex(doc)
      const asks = indexAsks(index)
      const outcome = askOutcome(index, asks, prompt, { running: false })
      const word = lastWord(index, asks, prompt)
      const text = word === null ? "" : (messageAt(index, word)?.text ?? "")
      const planned = planAnswer({
        relay,
        relayEntry: prompt,
        thread: lane,
        name: nameOf(lane),
        end:
          outcome.kind === "stopped"
            ? { kind: "stopped" }
            : outcome.kind === "failed" || text === ""
              ? { kind: "failed" }
              : { kind: "answered", text },
        spent: budgets.spent(relay.budget),
        fromReach: reachNow(relay.from),
      })
      await sendAnswer(lane, relay, planned)
    })
    if (relay.asker.kind === "person") await round(relay)
  }

  /**
   * After every member a person's message asked has answered (ADR-0128):
   * when it asked two or more, one request decides what comes next.
   */
  async function round(relay: RelayDetails): Promise<void> {
    if (reachNow(relay.from).kind !== "open") return
    const from = await threadNow(relay.from)
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
      threadMembers(from.index, from.end).map(t => [nameOf(t), t] as const),
    )
    const request = roundRequest({
      skill: skill.content,
      members: [...members.keys()],
      lines: transcriptLines(projectTranscript(from.index, from.end)),
    })
    await requestOutside({
      keeper: deps.keeper,
      failed: error =>
        basics.log(`[host] the round's request failed: ${error}`),
      request: async () => {
        const { text, tokens } = await deps.piSetup.complete(request)
        budgets.spendFrom(relay.budget, tokens)
        return text
      },
      settle: async reply => {
        const next = roundReplyOf(reply, members)
        if (next.kind === "people")
          queueFact({
            kind: "round",
            lane: relay.from,
            line: next.line,
            by: relay.by,
          })
        if (next.kind === "ask") {
          const now = await threadNow(relay.from)
          if (now === null) return
          await deliverRelay(relay.from, next.thread, {
            source: now.end ?? relay.source,
            asker: { kind: "person", writer: relay.by },
            askerName: personName(relay.by),
            text: next.text,
            budget: relay.budget,
            by: relay.by,
          })
        }
      },
    })
  }

  return { ask, leave, relayChat, relayCard, ended }
}
