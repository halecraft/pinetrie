// host/queued-card-pop — popping a lane's queued cards, top first, to send
// them (ADR-0048, ADR-0055, ADR-0083).
//
// People queue and unqueue cards through handoffs (ADR-0059); the host pops
// them, and only when the lane is not running, since a lane is never written
// while it runs (S21), its queue is not held, and nobody is typing in the
// top card (ADR-0048 step 7). Popping the next queued card is where the cards
// people still edit meet the tree. What a popped card comes to is decided
// first (`planCarry`): a fact appended, a catch-up then the card's text, a
// split's run, a message sent, or nothing (ADR-0080); `carryOut` carries it
// out.

import { subscribe } from "@kyneta/schema"
import {
  type CardId,
  type CardRecord,
  errorText,
  type LaneName,
  type OfferFact,
  PLAIN,
  parseMentions,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readRunning,
  readThreadName,
  readTypingIn,
} from "@pinetrie/reads"
import {
  type CarryPlan,
  displayName,
  encodeFact,
  planCarry,
  planNextQueuedCardPop,
  planUnsent,
  type QueuedCard,
  queuedOn,
} from "@pinetrie/rules"
import type { PlacesDocHandle, PresenceDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { Chat } from "./commands/chat.ts"
import { applyPlaceSteps } from "./places.ts"
import type { Provenance } from "./provenance.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

/** A queued card the host popped: its record as it was, and its text at the pop. */
export interface PoppedQueuedCard {
  readonly card: QueuedCard
  readonly text: string
}

/** A card the host could not send, in the words its writer reads. */
const hostFailedWords = (why: string): string => `the host failed: ${why}`

/**
 * What a pop found: nothing to pop, a held queue, a top card someone is
 * typing in, a top card whose text is behind, or a card popped.
 */
export type NextQueuedCardPop =
  | { readonly kind: "idle" }
  | { readonly kind: "held" }
  | { readonly kind: "typing"; readonly card: QueuedCard }
  | { readonly kind: "behind"; readonly card: QueuedCard }
  | { readonly kind: "popped"; readonly popped: PoppedQueuedCard }

/**
 * Pop a lane's next queued card: read that it is queued and on top, read its
 * text, and remove its record. Synchronous: an unqueue is a step on the same
 * keeper as the drain, so it runs before the pop or after it, never
 * between, and one after it is refused as gone. Idle when the lane runs or
 * nothing is queued; `held` and `typing` as `planNextQueuedCardPop` says
 * (ADR-0048 step 7). A card whose text the host does not yet hold as its
 * queuer had it is `behind`, and stays: Kyneta keeps no order between
 * documents, so its record can arrive before its text (S96). `texts` must
 * answer from texts already loaded.
 */
export function popNextQueuedCard(
  places: PlacesDocHandle,
  lane: LaneName,
  facts: Parameters<typeof planNextQueuedCardPop>[2],
  texts: Pick<CardPort, "textNow" | "holds">,
): NextQueuedCardPop {
  const step = planNextQueuedCardPop(readPlaces(places), lane, facts)
  if (step.kind !== "pop") return step
  const { card } = step
  if (!texts.holds(card.id, card.place.seen)) return { kind: "behind", card }
  const text = texts.textNow(card.id)
  applyPlaceSteps(places, [{ kind: "remove", id: card.id }])
  return { kind: "popped", popped: { card, text } }
}

/** A popped card's text as its queuer's message, in the queue's own mode. */
export const chatOfPoppedQueuedCard = (popped: PoppedQueuedCard): Chat => ({
  text: popped.text,
  root: popped.card.place.root,
  at: popped.card.place.at,
  mode: "queue",
  lane: popped.card.place.lane,
  asksAgent: false,
  mentions: parseMentions(popped.text),
  work: null,
  card: { id: popped.card.id, seen: popped.card.place.seen },
  // Its thread's pinned cards were edited long before it was popped.
  pinned: [],
  reserved: null,
  base: null,
  state: null,
})

export interface QueuedCardPopDeps {
  readonly basics: Pick<Basics, "session" | "live" | "places" | "log" | "now">
  /** Who is typing in which card (`typingIn`): the pop waits for them. */
  readonly presence: PresenceDocHandle
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "holds" | "destroy">
  /** Where a fact is appended (ADR-0080). */
  readonly agent: Pick<Agent, "lane">
  readonly work: Pick<LaneWork, "prepareUpdate" | "prepareSplit">
  readonly start: Runs["start"]
  /** Send a popped card's text as its queuer's message, through `sendChat`. */
  readonly send: (popped: PoppedQueuedCard) => Promise<Outcome>
  /** The top card's text is behind: drain the lane again once the host holds it. */
  readonly behind: (card: QueuedCard) => void
  /** Someone is typing in the top card: drain the lane again once they stop. */
  readonly typing: (card: QueuedCard) => void
  /** Each card's history (ADR-0048 step 6). */
  readonly provenance: Pick<Provenance, "before" | "after">
}

/**
 * Pop a lane's queued cards in order until one starts a run or none is
 * left. Each card's text is loaded before the pop, so the pop reads it
 * whole. A popped card is spent once its message is written or running;
 * one that could not be sent goes back below the line, saying why
 * (`planUnsent`, S69 answer 5). A held queue ends the drain; a top card
 * whose text is behind, or that someone types in, ends it with a wait that
 * drains again. A run's end, startup, a move that queues a card on an idle
 * lane, and a release each drain again.
 */
export async function drain(
  deps: QueuedCardPopDeps,
  lane: LaneName,
): Promise<void> {
  const { places } = deps.basics
  const loaded = new Set<CardId>()
  for (;;) {
    const loading = queuedOn(readPlaces(places), lane)
      .map(c => c.id)
      .filter(id => !loaded.has(id))
    if (loading.length > 0) {
      await deps.texts.hydrate(loading)
      for (const id of loading) loaded.add(id)
      continue
    }
    // No await between the check above and the pop.
    const before = deps.provenance.before()
    const top = popNextQueuedCard(
      places,
      lane,
      {
        running: readRunning(deps.basics.live, lane),
        held: readQueueHolds(deps.basics.session).has(lane),
        typing: readTypingIn(deps.presence),
      },
      deps.texts,
    )
    // Nothing to pop, or a held queue: its release drains it again.
    if (top.kind === "idle" || top.kind === "held") return
    // The queue waits for its top card: those behind it keep their turn.
    if (top.kind === "behind") return deps.behind(top.card)
    if (top.kind === "typing") return deps.typing(top.card)
    const done = await carryOut(deps, lane, top.popped)
    // Popped, written back or below the line again: the host's own write.
    await deps.provenance.after({ kind: "host" }, before)
    if (done === "ran") return
  }
}

/**
 * One popped card, carried out as `planCarry` decides. "ran": a run started,
 * whose end drains again. The pop deleted its record, so a throw while it is
 * carried out writes it back too, or the card would be lost.
 */
async function carryOut(
  deps: QueuedCardPopDeps,
  lane: LaneName,
  popped: PoppedQueuedCard,
): Promise<"ran" | "next"> {
  const plan = planCarry(popped.card, popped.text)
  switch (plan.kind) {
    case "fact":
      return appendFact(deps, lane, popped, plan.fact)
    case "catch-up":
      return catchUpThenSend(deps, lane, popped, plan)
    case "split":
      return splitThen(deps, lane, popped, plan.intent)
    case "send":
      return sendCard(deps, popped, popped.card)
    case "discard":
      await deps.texts.destroy(popped.card.id)
      return "next"
  }
}

/**
 * A fact the host queued (ADR-0080), appended to the thread: the lane is
 * idle, since the pop found it so. One that cannot be appended is logged
 * and dropped: nobody could send it from below the line.
 */
async function appendFact(
  deps: QueuedCardPopDeps,
  lane: LaneName,
  popped: PoppedQueuedCard,
  fact: OfferFact,
): Promise<"next"> {
  const { session, log, now } = deps.basics
  await deps.texts.destroy(popped.card.id)
  const appended = await deps.agent
    .lane(lane)
    .append(
      encodeFact(
        fact,
        displayName(fact.by, readParticipantNames(session).get(fact.by)),
        now(),
      ),
    )
    .catch((error: unknown) => ({ kind: "failed", message: errorText(error) }))
  if (appended.kind !== "appended")
    log(
      `[host] ${readThreadName(session, lane)}: a fact was not written: ${"message" in appended ? appended.message : appended.kind}`,
    )
  return "next"
}

/**
 * A card that catches the thread up (ADR-0055): the update, then the card's
 * text sent, or carried into the resolution run when the merge conflicts.
 */
async function catchUpThenSend(
  deps: QueuedCardPopDeps,
  lane: LaneName,
  popped: PoppedQueuedCard,
  plan: Extract<CarryPlan, { readonly kind: "catch-up" }>,
): Promise<"ran" | "next"> {
  const { card } = popped
  const prepared = await deps.work
    .prepareUpdate(
      deps.agent.lane(lane),
      card.place.by,
      popped.text,
      plan.command,
      "send",
    )
    .catch((error: unknown) => {
      unsent(deps, card, hostFailedWords(errorText(error)))
      return null
    })
  if (prepared === null) return "next"
  if (prepared.kind === "refused") {
    unsent(deps, card, prepared.reason)
    return "next"
  }
  if (prepared.kind === "conflicted") {
    await deps.texts.destroy(card.id)
    deps.start(lane, {
      kind: "prompt",
      message: prepared.message,
      pinnedSeen: [],
    })
    return "ran"
  }
  if (plan.after === "discard") {
    await deps.texts.destroy(card.id)
    return "next"
  }
  // Brought up to date: what is left is a plain message.
  return sendCard(deps, popped, { ...card, carries: PLAIN })
}

/**
 * A card that splits the offer (ADR-0080): the split's own run, the card's
 * text its intent; refused, the card goes back below the line, saying why.
 */
async function splitThen(
  deps: QueuedCardPopDeps,
  lane: LaneName,
  popped: PoppedQueuedCard,
  intent: string,
): Promise<"ran" | "next"> {
  const { card } = popped
  const message = await deps.work
    .prepareSplit(lane, card.place.by, intent)
    .catch((error: unknown) => ({
      refused: hostFailedWords(errorText(error)),
    }))
  if ("refused" in message) {
    unsent(deps, card, message.refused)
    return "next"
  }
  await deps.texts.destroy(card.id)
  deps.start(lane, { kind: "prompt", message, pinnedSeen: [] })
  return "ran"
}

/** A popped card's text sent as its queuer's message; `sending` is what goes back if it cannot be. */
async function sendCard(
  deps: QueuedCardPopDeps,
  popped: PoppedQueuedCard,
  sending: QueuedCard,
): Promise<"ran" | "next"> {
  const { card } = popped
  const sent = await deps.send(popped).catch((error: unknown) => {
    unsent(deps, sending, hostFailedWords(errorText(error)))
    return null
  })
  if (sent === null) return "next"
  switch (sent.kind) {
    case "appended":
    case "started":
      await deps.texts.destroy(card.id)
      return sent.kind === "started" ? "ran" : "next"
    case "busy":
      // A run started under the pop: the card goes back on top, as it was.
      applyPlaceSteps(deps.basics.places, [{ kind: "write", record: sending }])
      return "ran"
    case "refused":
      unsent(deps, sending, sent.message)
      return "next"
    case "conflict":
      unsent(deps, sending, "two threads end here: send it from one of them")
      return "next"
    case "failed":
      unsent(deps, sending, hostFailedWords(sent.message))
      return "next"
    default:
      unsent(deps, sending, `not sent: ${sent.kind}`)
      return "next"
  }
}

/** Write a card the host could not send back below the line, whole, saying why. */
function unsent(
  deps: QueuedCardPopDeps,
  card: QueuedCard,
  reason: string,
): void {
  const { session, places, log } = deps.basics
  applyPlaceSteps(places, [planUnsent(card, reason)])
  log(
    `[host] ${readThreadName(session, card.place.lane)}: a queued card was not sent: ${reason}`,
  )
}

/**
 * The waits for a queued card's text to give up (`behind`): each awaited
 * card no longer queued. The pop removed it, someone unqueued it, took it
 * into an inventory or discarded it, or its lane went: it will not be
 * popped, so nothing is left to wait for. Pure.
 */
export const givenUp = (
  awaited: Iterable<CardId>,
  cards: readonly CardRecord[],
): CardId[] => {
  const queued = new Set(
    cards.filter(c => c.place.kind === "queued").map(c => c.id),
  )
  return [...awaited].filter(id => !queued.has(id))
}

/**
 * The drain's waits for its top card (ADR-0048 step 7, S96): once per card,
 * until `until` resolves, then drain its lane again. A wait is given up
 * when its card leaves the queue (`givenUp`), so no subscription outlives a
 * card the pop will never reach. The places are watched only while a wait
 * is out. A card already awaited is not awaited twice: the drain that
 * follows the first wait asks again if it must.
 */
export function createWaits(deps: {
  readonly places: PlacesDocHandle
  readonly drain: (lane: LaneName) => void
}): (card: QueuedCard, until: (signal: AbortSignal) => Promise<void>) => void {
  const awaiting = new Map<CardId, AbortController>()
  let unwatch: (() => void) | null = null
  const watch = () => {
    unwatch ??= subscribe(deps.places, () => {
      for (const id of givenUp(awaiting.keys(), readPlaces(deps.places)))
        awaiting.get(id)?.abort()
    })
  }
  return (card, until) => {
    if (awaiting.has(card.id)) return
    const stop = new AbortController()
    awaiting.set(card.id, stop)
    watch()
    void until(stop.signal).then(() => {
      awaiting.delete(card.id)
      if (awaiting.size === 0) {
        unwatch?.()
        unwatch = null
      }
      if (!stop.signal.aborted) deps.drain(card.place.lane)
    })
  }
}

/**
 * Resolves once nobody is typing in `card` (`readTypingIn`), as soon as
 * their presence decays (S28), or when `signal` gives the wait up.
 */
export function untilNotTyped(
  presence: PresenceDocHandle,
  card: CardId,
  signal: AbortSignal,
): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      unsubscribe()
      signal.removeEventListener("abort", done)
      resolve()
    }
    const unsubscribe = subscribe(presence, () => {
      if (!readTypingIn(presence).has(card)) done()
    })
    signal.addEventListener("abort", done)
    if (signal.aborted || !readTypingIn(presence).has(card)) done()
  })
}
