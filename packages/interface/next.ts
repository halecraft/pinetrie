// interface/next — what a thread does next, for its dock's queue header
// (ADR-0113): the run, the queue's top card, a stop to resume, or nothing.
// Read from the host's own rules (`planNextQueuedCardPop`, `carryOnState`),
// so ▸ and the host cannot disagree. PURE.

import {
  type AskIndex,
  type CardId,
  type CardRecord,
  type LaneView,
  promptOf,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import {
  carryOnState,
  displayName,
  isQueuedMessage,
  planNextQueuedCardPop,
  queuedOn,
  stopperOf,
} from "@pinetrie/rules"
import type { ControlWords } from "./card-words.ts"
import type { Reader } from "./send.ts"

/** What a thread does next. */
export type Next =
  /** The agent runs. */
  | { readonly kind: "running" }
  /**
   * The queue is held. `top` is the card a release sends first (null with
   * none to send), `count` the messages it sends, and `resumable` whether
   * the stopped turn may also carry on.
   */
  | {
      readonly kind: "held"
      readonly by: WriterId
      readonly top: CardId | null
      readonly count: number
      readonly resumable: boolean
    }
  /** `top` goes now, or once nobody types in it (`typing`). */
  | {
      readonly kind: "sending"
      readonly top: CardId
      readonly typing: boolean
    }
  /** The agent was stopped, and may carry on. */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  /** Nothing happens until someone sends. */
  | { readonly kind: "idle" }

/** A thread's queue header: what happens next, on which lane. */
export interface QueueHead {
  readonly lane: ThreadId
  readonly next: Next
  /** Who holds the queue; null when it is not held. */
  readonly heldBy: WriterId | null
  /** Message cards queued: what unqueue all takes back. */
  readonly messages: number
}

export interface NextFacts {
  readonly cards: readonly CardRecord[]
  /** The cards someone types in now (presence `typingIn`). */
  readonly typing: ReadonlySet<CardId>
  /** The queued cards that are blank messages (`blankQueued`): the drain passes over them. */
  readonly blank: ReadonlySet<CardId>
  readonly index: TreeIndex
  readonly asks: AskIndex
}

/**
 * What `lane` does next, as its host would decide it: running; else the pop
 * `planNextQueuedCardPop` plans, a blank message passed over as the drain
 * passes it (`blankQueued`); else a stop `carryOnState` lets carry on;
 * else idle.
 */
export function nextOf(lane: LaneView, facts: NextFacts): Next {
  if (lane.running) return { kind: "running" }
  const queue = queuedOn(facts.cards, lane.name)
  const { blank } = facts
  const resumable =
    carryOnState(lane, { index: facts.index, asks: facts.asks }).kind === "ok"
  if (lane.heldBy !== null) {
    const released = planNextQueuedCardPop(facts.cards, lane.name, {
      running: false,
      away: false,
      held: false,
      typing: new Set(),
      blank,
    })
    return {
      kind: "held",
      by: lane.heldBy,
      top: released.kind === "pop" ? released.card.id : null,
      count: queue.filter(c => isQueuedMessage(c) && !blank.has(c.id)).length,
      resumable,
    }
  }
  const step = planNextQueuedCardPop(facts.cards, lane.name, {
    running: false,
    away: false,
    held: false,
    typing: facts.typing,
    blank,
  })
  if (step.kind === "pop" || step.kind === "typing")
    return {
      kind: "sending",
      top: step.card.id,
      typing: step.kind === "typing",
    }
  if (resumable) {
    const prompt = promptOf(facts.index, lane.tip)
    return {
      kind: "stopped",
      by:
        prompt === null
          ? null
          : stopperOf(facts.asks, queuedOn(facts.cards, lane.name), prompt),
    }
  }
  return { kind: "idle" }
}

/** `lane`'s queue header (`nextOf`), with what its ⋯ acts on. */
export function queueHead(lane: LaneView, facts: NextFacts): QueueHead {
  return {
    lane: lane.name,
    next: nextOf(lane, facts),
    heldBy: lane.heldBy,
    messages: queuedOn(facts.cards, lane.name).filter(isQueuedMessage).length,
  }
}

/** The one button a queue header shows, by the request or act it is. */
export type NextButton = "stop" | "send-queue" | "resume"

/** An item of the queue header's ⋯. */
export type NextItem = "resume" | "hold" | "release" | "unqueue-all"

/** Where ▸ sits: the run, a queued card, or your message's send. */
export type NextMark =
  | { readonly kind: "run" }
  | { readonly kind: "card"; readonly card: CardId }
  | { readonly kind: "message" }
  | { readonly kind: "none" }

/** What a queue header shows, decided: its button, its ⋯, and ▸. */
export interface QueueHeadPlan {
  readonly button: NextButton | null
  readonly items: readonly NextItem[]
  readonly mark: NextMark
}

/**
 * One button, the rest in ⋯ (ADR-0113): stop while it runs; send queue
 * while held with something to send, resume in ⋯ when the turn may carry
 * on; resume when stopped; none when idle or sending. Hold queue while it
 * is not held, release while it is held with nothing to send, and unqueue
 * all while a message card waits. Pure.
 */
export function queueHeadPlan(head: QueueHead): QueueHeadPlan {
  const { next } = head
  const button: NextButton | null =
    next.kind === "running"
      ? "stop"
      : next.kind === "held"
        ? next.count > 0
          ? "send-queue"
          : next.resumable
            ? "resume"
            : null
        : next.kind === "stopped"
          ? "resume"
          : null
  const items: NextItem[] = []
  if (next.kind === "held" && next.resumable && button !== "resume")
    items.push("resume")
  if (head.heldBy === null) items.push("hold")
  else if (button !== "send-queue") items.push("release")
  if (head.messages > 0) items.push("unqueue-all")
  const mark: NextMark =
    next.kind === "running"
      ? { kind: "run" }
      : next.kind === "held"
        ? next.top === null
          ? { kind: "none" }
          : { kind: "card", card: next.top }
        : next.kind === "sending"
          ? { kind: "card", card: next.top }
          : { kind: "message" }
  return { button, items, mark }
}

const who = (by: WriterId | null, reader: Reader): string =>
  by === null
    ? "someone"
    : by === reader.me
      ? "you"
      : displayName(by, reader.nameOf.get(by))

/** What the queue header says of what happens next. */
export function nextWords(next: Next, reader: Reader): string {
  switch (next.kind) {
    case "running":
      return "◉ running"
    case "held":
      return `held by ${who(next.by, reader)}`
    case "sending":
      return next.typing ? "sends when the typing stops" : "sending"
    case "stopped":
      return `stopped by ${who(next.by, reader)}`
    case "idle":
      return "idle"
  }
}

/** The header's button in words: its label, title and class. */
export function nextButtonWords(
  button: NextButton,
  head: QueueHead,
): ControlWords {
  switch (button) {
    case "stop":
      return {
        label: "stop",
        title: "end the agent's turn here; cards queued are then held",
        className: "stop",
      }
    case "send-queue":
      return {
        label: `send queue (${head.next.kind === "held" ? head.next.count : 0})`,
        title: "release the hold: what is queued here is sent, in order",
        className: "release-queue",
      }
    case "resume":
      return {
        label: "resume",
        title:
          "carry on from where the agent was stopped: a new turn, with a message from the host",
        className: "resume",
      }
  }
}

/** A ⋯ item in words. */
export function nextItemWords(item: NextItem): ControlWords {
  switch (item) {
    case "resume":
      return {
        label: "resume",
        title:
          "carry on the stopped turn; what is queued stays held until it is sent",
        className: "resume",
      }
    case "hold":
      return {
        label: "hold queue",
        title: "nothing queued here is sent until someone sends the queue",
        className: "hold-queue",
      }
    case "release":
      return {
        label: "release hold",
        title: "a card queued here is sent when the thread is free",
        className: "release-queue",
      }
    case "unqueue-all":
      return {
        label: "unqueue all",
        title: "every queued card back to the notes",
        className: "unqueue-all",
      }
  }
}

/** The dock's "+ add to queue". */
export const ADD_TO_QUEUE: ControlWords = {
  label: "+ add to queue",
  title:
    "a new card at the queue's end; on an idle thread the queue is held while you write it",
  className: "add-to-queue",
}
