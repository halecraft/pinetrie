// host/take — taking a lane's queued cards, top first (ADR-0048, ADR-0055).
//
// People queue and unqueue cards through handoffs (ADR-0059); the host takes
// them, and only when the lane is not running, since a lane is never written
// while it runs (S21). The take is where the cards people still edit meet
// the tree.

import { type CardId, type LaneName, parseMentions } from "@pineta/core"
import {
  planTake,
  planUnsent,
  type QueuedCard,
  queuedOn,
} from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import { readPlaces, readRunning, readThreadName } from "@pineta/reads"
import type { PlacesDocHandle } from "@pineta/schema"
import { type Basics, messageOf } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { Chat } from "./commands/chat.ts"
import { applyPlaceStep } from "./places.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

/** A card the host took: its record as it was, and its text at the take. */
export interface Taken {
  readonly card: QueuedCard
  readonly text: string
}

/** What a take found: nothing to take, a top card whose text is behind, or a card taken. */
export type TakeTop =
  | { readonly kind: "idle" }
  | { readonly kind: "behind"; readonly card: QueuedCard }
  | { readonly kind: "taken"; readonly taken: Taken }

/**
 * Take a lane's top queued card: read that it is queued and on top, read its
 * text, and remove its record. Synchronous: an unqueue is a step on the same
 * keeper as the drain, so it runs before the take or after it, never
 * between, and one after it is refused as gone. Idle when the lane runs or
 * nothing is queued. A card whose text the host does not yet hold as its
 * queuer had it is `behind`, and stays: Kyneta keeps no order between
 * documents, so its record can arrive before its text (S72). `texts` must
 * answer from texts already loaded.
 */
export function takeTop(
  places: PlacesDocHandle,
  lane: LaneName,
  running: boolean,
  texts: Pick<CardPort, "textNow" | "holds">,
): TakeTop {
  const step = planTake(readPlaces(places), lane, running)
  if (step.kind === "idle") return { kind: "idle" }
  const { card } = step
  if (!texts.holds(card.id, card.place.seen)) return { kind: "behind", card }
  const text = texts.textNow(card.id)
  applyPlaceStep(places, { kind: "remove", id: card.id })
  return { kind: "taken", taken: { card, text } }
}

/** A taken card's text as its queuer's message, in the queue's own mode. */
export const takenChat = (taken: Taken): Chat => ({
  text: taken.text,
  root: taken.card.place.root,
  at: taken.card.place.at,
  mode: "queue",
  lane: taken.card.place.lane,
  asksAgent: false,
  mentions: parseMentions(taken.text),
  work: null,
  card: { id: taken.card.id, seen: taken.card.place.seen },
  reserved: null,
  base: null,
})

export interface TakeDeps {
  readonly basics: Pick<Basics, "session" | "live" | "places" | "log">
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "holds" | "destroy">
  readonly work: Pick<LaneWork, "prepareUpdate">
  readonly start: Runs["start"]
  /** Send a taken card's text as its queuer's message, through `sendChat`. */
  readonly send: (taken: Taken) => Promise<Outcome>
  /** The top card's text is behind: drain the lane again once the host holds it. */
  readonly behind: (card: QueuedCard) => void
}

/**
 * Take a lane's queued cards in order until one starts a run or none is
 * left. Each card's text is loaded before the take, so the take reads it
 * whole. A taken card is spent once its message is written or running;
 * one that could not be sent goes back below the line, saying why
 * (`planUnsent`, S69 answer 5). A run's end, startup and a move that queues
 * a card on an idle lane each drain again.
 */
export async function drain(deps: TakeDeps, lane: LaneName): Promise<void> {
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
    // No await between the check above and the take.
    const top = takeTop(
      places,
      lane,
      readRunning(deps.basics.live, lane),
      deps.texts,
    )
    if (top.kind === "idle") return
    // The queue waits for its top card: those behind it keep their turn.
    if (top.kind === "behind") return deps.behind(top.card)
    if ((await carryOut(deps, lane, top.taken)) === "ran") return
  }
}

/**
 * One taken card, sent through its command. "ran": a run started, whose end
 * drains again. The take deleted its record, so a throw while it is carried
 * out writes it back too, or the card would be lost.
 */
async function carryOut(
  deps: TakeDeps,
  lane: LaneName,
  taken: Taken,
): Promise<"ran" | "next"> {
  const { card } = taken
  let sending = card
  const hostFailed = (error: unknown) => {
    unsent(deps, sending, `the host failed: ${messageOf(error)}`)
    return null
  }
  if (card.command !== null) {
    const prepared = await deps.work
      .prepareUpdate(
        lane,
        card.place.by,
        taken.text,
        card.command === "continue-on-line",
      )
      .catch(hostFailed)
    if (prepared === null) return "next"
    if (prepared.kind === "refused") {
      unsent(deps, card, prepared.reason)
      return "next"
    }
    if (prepared.kind === "conflicted") {
      await deps.texts.destroy(card.id)
      deps.start(lane, { kind: "prompt", message: prepared.message })
      return "ran"
    }
    // Brought up to date: what is left is a plain message.
    sending = { ...card, command: null }
  }
  if (taken.text.trim() === "") {
    await deps.texts.destroy(card.id)
    return "next"
  }
  const sent = await deps.send(taken).catch(hostFailed)
  if (sent === null) return "next"
  switch (sent.kind) {
    case "appended":
    case "started":
      await deps.texts.destroy(card.id)
      return sent.kind === "started" ? "ran" : "next"
    case "busy":
      // A run started under the take: the card goes back on top, as it was.
      applyPlaceStep(deps.basics.places, { kind: "write", record: sending })
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
function unsent(deps: TakeDeps, card: QueuedCard, reason: string): void {
  const { session, places, log } = deps.basics
  applyPlaceStep(places, planUnsent(card, reason))
  log(
    `[host] ${readThreadName(session, card.place.lane)}: a queued card was not sent: ${reason}`,
  )
}
