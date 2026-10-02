// host/take — taking a lane's queued cards, top first (ADR-0048, ADR-0055).
//
// Clients queue and unqueue cards; the host takes them, and only when the
// lane is not running, since a lane is never written while it runs (S21).
// The take is where the cards people still edit meet the tree.

import { type CardId, type LaneName, parseMentions } from "@pineta/core"
import {
  encodeCard,
  planTake,
  planUnsent,
  type QueuedCard,
  queuedOn,
} from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import { readCards, readRunning, readThreadName } from "@pineta/reads"
import type { CardsDocHandle } from "@pineta/schema"
import { type Basics, messageOf } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { Chat } from "./commands/chat.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

/** A card the host took: its record as it was, and its text at the take. */
export interface Taken {
  readonly card: QueuedCard
  readonly text: string
}

/**
 * Take a lane's top queued card: read that it is queued and on top, read its
 * text, and delete its record. Synchronous, so no unqueue can land between
 * the read and the delete: an unqueue the host has seen means the card is not
 * taken, and one it has not seen loses (S69, consequence 1). Null when the
 * lane runs or nothing is queued. `textOf` must answer from a text already
 * loaded.
 */
export function takeTop(
  cards: CardsDocHandle,
  lane: LaneName,
  running: boolean,
  textOf: (id: CardId) => string,
): Taken | null {
  const step = planTake(readCards(cards), lane, running)
  if (step.kind === "idle") return null
  const text = textOf(step.card.id)
  cards.cards.delete(step.card.id)
  return { card: step.card, text }
}

/** A taken card's text as its queuer's message, in the queue's own mode. */
export const takenChat = (taken: Taken): Chat => ({
  text: taken.text,
  at: taken.card.place.at,
  mode: "queue",
  lane: taken.card.place.lane,
  asksAgent: false,
  mentions: parseMentions(taken.text),
  work: null,
  card: taken.card.id,
  reserved: null,
})

export interface TakeDeps {
  readonly basics: Pick<Basics, "doc" | "cards" | "log">
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "destroy">
  readonly work: Pick<LaneWork, "prepareUpdate">
  readonly start: Runs["start"]
  /** Send a taken card's text as its queuer's message, through `sendChat`. */
  readonly send: (taken: Taken) => Promise<Outcome>
}

/**
 * Take a lane's queued cards in order until one starts a run or none is
 * left. Each card's text is loaded before the take, so the take reads it
 * whole. A taken card is spent once its message is written or running;
 * one that could not be sent goes back below the line, saying why
 * (`planUnsent`, S69 answer 5). A run's end, startup and a change to the
 * cards document each drain again.
 */
export async function drain(deps: TakeDeps, lane: LaneName): Promise<void> {
  const { doc, cards } = deps.basics
  const loaded = new Set<CardId>()
  for (;;) {
    const loading = queuedOn(readCards(cards), lane)
      .map(c => c.id)
      .filter(id => !loaded.has(id))
    if (loading.length > 0) {
      await deps.texts.hydrate(loading)
      for (const id of loading) loaded.add(id)
      continue
    }
    // No await between the check above and the take.
    const taken = takeTop(
      cards,
      lane,
      readRunning(doc, lane),
      deps.texts.textNow,
    )
    if (taken === null) return
    if ((await carryOut(deps, lane, taken)) === "ran") return
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
  if (card.command === "bring-up-to-date") {
    const prepared = await deps.work
      .prepareUpdate(lane, card.place.by, taken.text)
      .catch(hostFailed)
    if (prepared === null) return "next"
    if ("refused" in prepared) {
      unsent(deps, card, prepared.refused)
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
      deps.basics.cards.cards.set(card.id, encodeCard(sending))
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
  const { doc, cards, log } = deps.basics
  cards.cards.set(card.id, planUnsent(card, reason))
  log(
    `[host] ${readThreadName(doc, card.place.lane)}: a queued card was not sent: ${reason}`,
  )
}
