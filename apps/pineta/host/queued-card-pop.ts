// host/queued-card-pop — popping a lane's queued cards, top first, to send
// them (ADR-0048, ADR-0055, ADR-0083).
//
// People queue and unqueue cards through handoffs (ADR-0059); the host pops
// them, and only when the lane is not running, since a lane is never written
// while it runs (S21). Popping the next queued card is where the cards
// people still edit meet the tree.

import { subscribe } from "@kyneta/schema"
import {
  type CardId,
  type CardRecord,
  type LaneName,
  parseMentions,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { readPlaces, readRunning, readThreadName } from "@pineta/reads"
import {
  planNextQueuedCardPop,
  planUnsent,
  type QueuedCard,
  queuedOn,
} from "@pineta/rules"
import type { PlacesDocHandle } from "@pineta/schema"
import { type Basics, messageOf } from "./basics.ts"
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

/** What a pop found: nothing to pop, a top card whose text is behind, or a card popped. */
export type NextQueuedCardPop =
  | { readonly kind: "idle" }
  | { readonly kind: "behind"; readonly card: QueuedCard }
  | { readonly kind: "popped"; readonly popped: PoppedQueuedCard }

/**
 * Pop a lane's next queued card: read that it is queued and on top, read its
 * text, and remove its record. Synchronous: an unqueue is a step on the same
 * keeper as the drain, so it runs before the pop or after it, never
 * between, and one after it is refused as gone. Idle when the lane runs or
 * nothing is queued. A card whose text the host does not yet hold as its
 * queuer had it is `behind`, and stays: Kyneta keeps no order between
 * documents, so its record can arrive before its text (S96). `texts` must
 * answer from texts already loaded.
 */
export function popNextQueuedCard(
  places: PlacesDocHandle,
  lane: LaneName,
  running: boolean,
  texts: Pick<CardPort, "textNow" | "holds">,
): NextQueuedCardPop {
  const step = planNextQueuedCardPop(readPlaces(places), lane, running)
  if (step.kind === "idle") return { kind: "idle" }
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
})

export interface QueuedCardPopDeps {
  readonly basics: Pick<Basics, "session" | "live" | "places" | "log">
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "holds" | "destroy">
  readonly work: Pick<LaneWork, "prepareUpdate">
  readonly start: Runs["start"]
  /** Send a popped card's text as its queuer's message, through `sendChat`. */
  readonly send: (popped: PoppedQueuedCard) => Promise<Outcome>
  /** The top card's text is behind: drain the lane again once the host holds it. */
  readonly behind: (card: QueuedCard) => void
  /** Each card's history (ADR-0048 step 6). */
  readonly provenance: Pick<Provenance, "before" | "after">
}

/**
 * Pop a lane's queued cards in order until one starts a run or none is
 * left. Each card's text is loaded before the pop, so the pop reads it
 * whole. A popped card is spent once its message is written or running;
 * one that could not be sent goes back below the line, saying why
 * (`planUnsent`, S69 answer 5). A run's end, startup and a move that queues
 * a card on an idle lane each drain again.
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
      readRunning(deps.basics.live, lane),
      deps.texts,
    )
    if (top.kind === "idle") return
    // The queue waits for its top card: those behind it keep their turn.
    if (top.kind === "behind") return deps.behind(top.card)
    const done = await carryOut(deps, lane, top.popped)
    // Popped, written back or below the line again: the host's own write.
    await deps.provenance.after({ kind: "host" }, before)
    if (done === "ran") return
  }
}

/**
 * One popped card, sent through its command. "ran": a run started, whose end
 * drains again. The pop deleted its record, so a throw while it is carried
 * out writes it back too, or the card would be lost.
 */
async function carryOut(
  deps: QueuedCardPopDeps,
  lane: LaneName,
  popped: PoppedQueuedCard,
): Promise<"ran" | "next"> {
  const { card } = popped
  let sending = card
  const hostFailed = (error: unknown) => {
    unsent(deps, sending, `the host failed: ${messageOf(error)}`)
    return null
  }
  if (card.command !== null) {
    const prepared = await deps.work
      .prepareUpdate(lane, card.place.by, popped.text, card.command)
      .catch(hostFailed)
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
    // Brought up to date: what is left is a plain message.
    sending = { ...card, command: null }
  }
  if (popped.text.trim() === "") {
    await deps.texts.destroy(card.id)
    return "next"
  }
  const sent = await deps.send(popped).catch(hostFailed)
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
      unsent(deps, sending, `the host failed: ${sent.message}`)
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
 * The drain's `behind`: wait once per card for its text as its queuer had
 * it, then drain its lane again. A wait is given up when its card leaves
 * the queue (`givenUp`), so no subscription outlives a card the pop will
 * never reach. The places are watched only while a wait is out.
 */
export function createBehind(deps: {
  readonly places: PlacesDocHandle
  readonly texts: Pick<CardPort, "whenHolds">
  readonly drain: (lane: LaneName) => void
}): (card: QueuedCard) => void {
  const awaiting = new Map<CardId, AbortController>()
  let unwatch: (() => void) | null = null
  const watch = () => {
    unwatch ??= subscribe(deps.places, () => {
      for (const id of givenUp(awaiting.keys(), readPlaces(deps.places)))
        awaiting.get(id)?.abort()
    })
  }
  return card => {
    if (awaiting.has(card.id)) return
    const stop = new AbortController()
    awaiting.set(card.id, stop)
    watch()
    void deps.texts
      .whenHolds(card.id, card.place.seen, stop.signal)
      .then(() => {
        awaiting.delete(card.id)
        if (awaiting.size === 0) {
          unwatch?.()
          unwatch = null
        }
        if (!stop.signal.aborted) deps.drain(card.place.lane)
      })
  }
}
