// host/relays — another thread's agent asked.
//
// An ask, a person's (`relayMessage`) or an agent's (`ask`, its tool's hook),
// is relayed into the asked thread: what it has not heard of the asking
// thread first, then the ask as its run's prompt; a busy agent gets an ask
// card instead, which its drain relays (`relayCard`). What the relayed run
// sends back is `answers.ts`'. Each step gathers, plans with
// `@pinetrie/rules` (`planRelay`, `planDelivery`) and then writes, in one
// keeper step. Where both threads are (`threadReach`) is gathered first,
// from the session and the places, and a thread out of reach is refused
// before any root is opened.

import {
  cardIdOfKind,
  type EntryId,
  lastHeardEntry,
  lastInvitation,
  messageText,
  projectTranscript,
  type QueuedFact,
  type RelayDetails,
  type ThreadId,
  type ThreadName,
  threadMembers,
} from "@pinetrie/core"
import { readArchived, readNames, readPlaces } from "@pinetrie/reads"
import {
  encodeHeard,
  encodeRelayMessage,
  planAskCard,
  planDelivery,
  planRelay,
  type RelayRefusal,
  reachableAgents,
  relayRefusalText,
  type ToolAnswer,
  unreachableRefusal,
} from "@pinetrie/rules"
import type { Basics, HostKeeper } from "./basics.ts"
import type { Budgets } from "./budgets.ts"
import { canvasesNow } from "./canvases.ts"
import { queueFact as queueFactIn } from "./facts.ts"
import type { Places } from "./places.ts"
import type { Runs } from "./runs.ts"
import { threadsNow } from "./threads-now.ts"
import type { LaneWork } from "./work/index.ts"

/** A tool's answer that is no merge: text alone. */
const said = (text: string, isError = false): ToolAnswer => ({
  text,
  isError,
  details: null,
})

/**
 * Every named thread on an open canvas: whose agents a message may name,
 * wherever it is sent. `agentCandidates` leaves its own thread out.
 */
export function readReachableAgents(
  docs: Pick<Basics, "places" | "session">,
): readonly { readonly thread: ThreadId; readonly name: ThreadName }[] {
  return reachableAgents({
    cardsOn: canvasesNow(docs).cardsOn,
    archived: readArchived(docs.session, docs.places),
    names: readNames(docs.session),
  })
}

export interface Relays {
  /** `ask` was called in `lane`'s run: relay it to the thread named `to`. */
  ask(lane: ThreadId, to: string, text: string): Promise<ToolAnswer>
  /** `leave` was called in `lane`'s run: leave the thread named `thread`. */
  leave(lane: ThreadId, thread: string): Promise<ToolAnswer>
  /** A person's chat, sent with `sendId` in `thread`, asked or invited members. */
  relayMessage(thread: ThreadId, sendId: string): Promise<void>
  /** An ask card popped on `lane`: relay it now. */
  relayCard(lane: ThreadId, relay: RelayDetails): Promise<"ran" | "next">
  /**
   * Relay into `to`, from `from`, inside a keeper step: refused for a thread
   * out of reach before either root is opened, else run there or queued as
   * an ask card. `end` is where the asking thread's path ends, when not at
   * its end now.
   */
  deliver(
    from: ThreadId,
    to: ThreadId,
    relay: Omit<RelayDetails, "from" | "fromName">,
    end?: EntryId,
  ): Promise<Delivered>
}

/** What a relay came to. */
export type Delivered =
  | { readonly kind: "ran" }
  | { readonly kind: "queued"; readonly held: boolean }
  | { readonly kind: "refused"; readonly why: RelayRefusal }

export function createRelays(deps: {
  readonly basics: Pick<
    Basics,
    "docs" | "session" | "places" | "live" | "now" | "newId" | "log"
  >
  readonly keeper: Pick<HostKeeper, "run" | "track">
  readonly start: Runs["start"]
  /** Whether a run may start on a lane (`LaneWork.runnable`). */
  readonly runnable: LaneWork["runnable"]
  readonly budgets: Budgets
  /** Ask for a lane's drain. */
  readonly drain: (lane: ThreadId) => void
  /** The writer of the places: an ask's card and a fact are the host's changes. */
  readonly placesWriter: Places
}): Relays {
  const { basics, budgets } = deps
  const { session, places } = basics
  const threads = threadsNow(basics)
  const { nameOf, personName } = threads

  /** Both threads of an ask, named, and where each is: gathered once, before any root is opened. */
  const bothReaches = (from: ThreadId, to: ThreadId) => ({
    fromName: nameOf(from),
    fromReach: threads.reach(from),
    toName: nameOf(to),
    toReach: threads.reach(to),
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
  ): Promise<Delivered> {
    const reaches = bothReaches(fromThread, to)
    const away = unreachableRefusal(reaches)
    if (away !== null) return { kind: "refused", why: away }
    const now = await threads.thread(fromThread)
    if (now === null)
      return {
        kind: "refused",
        why: { kind: "unknown", name: nameOf(fromThread) },
      }
    const from = end === undefined ? now : { ...now, end }
    // Proven once: the plan refuses a lane of another kind, and a run
    // starts only with the proof.
    const runnable = deps.runnable(to)
    const target = await threads.thread(to)
    const planned = planRelay({
      ...reaches,
      from: from.thread,
      to,
      members: threadMembers(from.index, from.end),
      toLane: target?.lane ?? { kind: "none" },
      toForeign: typeof runnable === "object" ? runnable : null,
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
      if (typeof runnable === "object")
        return {
          kind: "refused",
          why: { kind: "foreign", name: nameOf(to), lane: runnable },
        }
      const now = basics.now()
      deps.start(runnable, {
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
    if (card !== null)
      await deps.placesWriter.change({ kind: "host" }, open =>
        open.apply([card]),
      )
    deps.drain(to)
    return {
      kind: "queued",
      held: lane.kind === "lane" && lane.heldBy !== null,
    }
  }

  /** A fact for `thread`, queued as every fact is, and its drain asked for. */
  const queueFact = (fact: QueuedFact): Promise<void> => queueFactIn(deps, fact)

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
      const from = await threads.thread(lane)
      const target = findAgent(to)
      const budget = budgets.runBudget(lane)
      if (from === null || budget === null)
        return said("This call reached no thread.", true)
      if (target === null)
        return said(refusal({ kind: "unknown", name: to }), true)
      // A person's message whose run asks sets its budget now.
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
      const there = await threads.thread(left.thread)
      if (there === null) return said(refusal({ kind: "unknown", name }), true)
      if (!threadMembers(there.index, there.end).includes(lane))
        return said(`You are not a member of ${left.name}.`, true)
      await queueFact({
        kind: "left",
        lane: left.thread,
        member: lane,
        by,
      })
      return said(`You left ${left.name}: you are no longer asked there.`)
    })
  }

  async function relayMessage(thread: ThreadId, sendId: string): Promise<void> {
    await deps.keeper.run(async () => {
      const from = await threads.thread(thread)
      if (from === null) return
      const source = from.index.bySend.get(sendId)
      const personMessage =
        source === undefined ? undefined : from.index.entries[source]?.message
      const author = personMessage?.writer
      if (
        source === undefined ||
        personMessage === undefined ||
        author === undefined
      )
        return
      const asks = personMessage.asks ?? []
      if (asks.length === 0 && (personMessage.invites ?? []).length === 0)
        return
      await budgets.ensure(source, thread, author)
      // What came after the chat is not heard with it: its path ends there.
      for (const to of asks) {
        const delivered = await deliverRelay(
          thread,
          to,
          {
            source,
            asker: { kind: "person", writer: author },
            askerName: personMessage.author ?? "",
            text: messageText(personMessage),
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

  return { ask, leave, relayMessage, relayCard, deliver: deliverRelay }
}
