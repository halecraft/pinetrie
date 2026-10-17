// host/queued-card-pop — popping a lane's queued cards, top first, to send
// them.
//
// People queue and unqueue cards through handoffs; the host pops them, and only
// when the lane is not running, since a lane is never written while it runs,
// its queue is not held, and nobody is typing in the top card. A blank message
// is passed over, left where it is. Popping the next queued card is where the
// cards people still edit meet the tree. What a popped card comes to is decided
// first (`planCarry`): a fact appended, a catch-up then the card's text if it
// has any, a split's run, or a message sent; `carryOut` carries it out.

import { subscribe } from "@kyneta/schema"
import {
  type BlobStore,
  type CardId,
  type CardRecord,
  cardIdOfKind,
  cardTextSource,
  errorText,
  parseMentions,
  type QueuedFact,
  type RelayDetails,
  type RootId,
  type Send,
  type Sha256,
  type TextCardId,
  type ThreadId,
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
  blankQueued,
  type CarryPlan,
  displayName,
  encodeFact,
  foreignLaneWords,
  isQueuedText,
  planCarry,
  planNextQueuedCardPop,
  planQueueHold,
  planUnsent,
  type QueuedCard,
  type QueuedMessage,
  type QueuedText,
  queuedOn,
  sourceWords,
  threadCardHolding,
} from "@pinetrie/rules"
import type { PlacesDocHandle, PresenceDocHandle } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { OpenChange, Places } from "./places.ts"
import type { Records } from "./records.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"

/**
 * A queued card the host popped: its record as it was, and its words at the
 * pop (`sourceWords`): a text card's text, a reference's quote, a fact's line.
 */
export interface PoppedQueuedCard {
  readonly card: QueuedCard
  readonly text: string
}

/** A popped text card: a message, sent as its queuer's. */
export interface PoppedText {
  readonly card: QueuedText
  readonly text: string
}

/** A popped card sent as its queuer's message: a text card, or a reference's quote. */
export interface PoppedMessage {
  readonly card: QueuedMessage
  readonly text: string
}

/** A card the host could not send, in the words its writer reads. */
const hostFailedWords = (why: string): string => `the host failed: ${why}`

/**
 * What a pop found: nothing to pop, a held queue, a top card someone is
 * typing in, only blank cards, a top card whose text is behind, or a card
 * popped.
 */
export type NextQueuedCardPop =
  | { readonly kind: "idle" }
  | { readonly kind: "held" }
  | { readonly kind: "typing"; readonly card: QueuedText }
  | { readonly kind: "blank"; readonly card: QueuedText }
  | { readonly kind: "behind"; readonly card: QueuedText }
  | { readonly kind: "popped"; readonly popped: PoppedQueuedCard }

/**
 * Pop a lane's next queued card: read that it is queued and on top, read its
 * text, and remove its record. Synchronous: an unqueue is a step on the same
 * keeper as the drain, so it runs before the pop or after it, never between,
 * and one after it is refused as gone. Idle when the lane runs or nothing is
 * queued; `held`, `typing` and `blank` as `planNextQueuedCardPop` says. A card
 * whose text the host does not yet hold as its queuer had it is `behind`, and
 * stays: Kyneta keeps no order between documents, so its record can arrive
 * before its text. Such a card is not blank, though its text reads empty so
 * far: passing over it would send the cards behind it first. `texts` must
 * answer from texts already loaded, and `quotes` holds each queued reference's
 * quote, read before.
 */
export function popNextQueuedCard(
  open: Pick<OpenChange, "apply">,
  places: PlacesDocHandle,
  lane: ThreadId,
  facts: Omit<Parameters<typeof planNextQueuedCardPop>[2], "blank">,
  texts: Pick<CardPort, "textNow" | "holds">,
  quotes: ReadonlyMap<Sha256, string> = new Map(),
): NextQueuedCardPop {
  const cards = readPlaces(places)
  const blank = blankQueued(queuedOn(cards, lane), {
    holds: texts.holds,
    text: texts.textNow,
  })
  const step = planNextQueuedCardPop(cards, lane, { ...facts, blank })
  if (step.kind !== "pop") return step
  const { card } = step
  if (isQueuedText(card) && !texts.holds(card.id, card.place.seen))
    return { kind: "behind", card }
  const text = sourceWords(cardTextSource(card), {
    doc: texts.textNow,
    blob: sha => quotes.get(sha) ?? "",
  })
  open.apply([{ kind: "remove", id: card.id }])
  return { kind: "popped", popped: { card, text } }
}

/**
 * A popped card's text as its queuer's message, in the queue's own mode, in
 * `root`, its thread's (`THREAD`).
 */
export const sendOfPoppedQueuedCard = (
  popped: PoppedMessage,
  root: RootId,
): Send => ({
  kind: "send",
  text: popped.text,
  root,
  at: { kind: "queue", thread: popped.card.place.thread },
  mentions: parseMentions(popped.text),
  // A reference is sent from no text card: nothing is spent with it.
  card:
    popped.card.kind === "text"
      ? { id: popped.card.id, seen: popped.card.place.seen }
      : null,
  // Its thread's pinned cards were edited long before it was popped.
  pinned: [],
  base: null,
  state: null,
})

export interface QueuedCardPopDeps {
  readonly basics: Pick<
    Basics,
    "session" | "live" | "places" | "log" | "now" | "newId"
  >
  /** A queue's hold, written when an unsent card has nowhere to go. */
  readonly records: Pick<Records, "writeValues">
  /** Who is typing in which card (`typingIn`): the pop waits for them. */
  readonly presence: PresenceDocHandle
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "holds">
  /** Where a fact is appended. */
  readonly agent: Pick<Agent, "lane">
  readonly work: Pick<LaneWork, "prepareUpdate" | "prepareSplit" | "runnable">
  /** Start a run in the drain's step, whose documents lease its root. */
  readonly start: (
    ...args: Parameters<Runs["start"]> extends [unknown, ...infer R] ? R : never
  ) => ReturnType<Runs["start"]>
  /** Send a popped card's text as its queuer's message, through the gate and `sendMessage`. */
  readonly send: (popped: PoppedMessage) => Promise<Outcome>
  /** Where a queued reference's quote is read. */
  readonly blobs: Pick<BlobStore, "get">
  /** The top card's text is behind: drain the lane again once the host holds it. */
  readonly behind: (card: QueuedText) => void
  /** Someone is typing in the top card: drain the lane again once they stop. */
  readonly typing: (card: QueuedText) => void
  /** Only blank cards are queued: drain the lane again once `card` is written in. */
  readonly blank: (card: QueuedText) => void
  /**
   * The writer of the places: each pop is one change of the host's, so a
   * popped card's text goes as it closes unless the card was written back.
   */
  readonly placesWriter: Places
  /** Relay a popped ask card's ask: "ran" when its run started. */
  readonly relay: (
    lane: ThreadId,
    relay: RelayDetails,
  ) => Promise<"ran" | "next">
  /**
   * Append a fact to a thread with no lane, at its end: a chat an agent
   * was asked from. False when it could not be.
   */
  readonly appendLaneless: (
    thread: ThreadId,
    fact: QueuedFact,
  ) => Promise<boolean>
}

/**
 * Pop a lane's queued cards in order until one starts a run or none is left.
 * Each card's text is loaded before the pop, so the pop reads it whole. A
 * popped card is spent once its message is written or running; one that could
 * not be sent goes back below the line, saying why (`planUnsent`). A held queue
 * ends the drain; a top card whose text is behind, or that someone types in,
 * ends it with a wait that drains again; so does a queue of blank cards alone,
 * until one is written in. A run's end, startup, a move that queues a card on
 * an idle lane, and a release each drain again.
 */
export async function drain(
  deps: QueuedCardPopDeps,
  lane: ThreadId,
): Promise<void> {
  const { places } = deps.basics
  const loaded = new Set<CardId>()
  for (;;) {
    const loading = queuedOn(readPlaces(places), lane)
      .flatMap((c): TextCardId[] => {
        const source = cardTextSource(c)
        return source.kind === "doc" ? [source.card] : []
      })
      .filter(id => !loaded.has(id))
    if (loading.length > 0) {
      await deps.texts.hydrate(loading)
      for (const id of loading) loaded.add(id)
      continue
    }
    const quotes = queuedQuotes(deps.blobs, readPlaces(places), lane)
    // No await between the check above and the pop: the change calls its
    // body at once. Popped, written back or below the line again, it is
    // the host's own change.
    const top = await deps.placesWriter.change({ kind: "host" }, async open => {
      const next = popNextQueuedCard(
        open,
        places,
        lane,
        {
          running: readRunning(deps.basics.live, lane),
          // A pop runs in its own thread: held, it has no runner, and a lane
          // of another kind runs nothing. The gate refuses both at its send.
          away:
            threadCardHolding(readPlaces(places), lane).kind !== "free" ||
            typeof deps.work.runnable(lane) === "object",
          held: readQueueHolds(deps.basics.session).has(lane),
          typing: readTypingIn(deps.presence),
        },
        deps.texts,
        quotes,
      )
      return next.kind === "popped"
        ? ({
            kind: "carried",
            done: await carryOut(deps, open, lane, next.popped),
          } as const)
        : next
    })
    // Nothing to pop, or a held queue: its release drains it again.
    if (top.kind === "idle" || top.kind === "held") return
    // The queue waits for its top card: those behind it keep their turn.
    if (top.kind === "behind") return deps.behind(top.card)
    if (top.kind === "typing") return deps.typing(top.card)
    if (top.kind === "blank") return deps.blank(top.card)
    if (top.done === "ran") return
  }
}

/** The quote of each reference queued on `lane`, read from its blob. */
function queuedQuotes(
  blobs: Pick<BlobStore, "get">,
  cards: readonly CardRecord[],
  lane: ThreadId,
): ReadonlyMap<Sha256, string> {
  const quotes = new Map<Sha256, string>()
  for (const c of queuedOn(cards, lane)) {
    const source = cardTextSource(c)
    if (source.kind !== "blob") continue
    const blob = blobs.get(source.sha)
    if (blob !== undefined)
      quotes.set(source.sha, new TextDecoder().decode(blob.bytes))
  }
  return quotes
}

/**
 * One popped card, carried out as `planCarry` decides. "ran": a run started,
 * whose end drains again. The pop deleted its record, so a throw while it is
 * carried out writes it back too, or the card would be lost.
 */
async function carryOut(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  lane: ThreadId,
  popped: PoppedQueuedCard,
): Promise<"ran" | "next"> {
  const plan = planCarry(popped.card, popped.text)
  switch (plan.kind) {
    case "fact":
      return appendFact(deps, lane, plan.fact)
    case "catch-up":
      return catchUpThenSend(
        deps,
        open,
        lane,
        { card: plan.card, text: popped.text },
        plan,
      )
    case "split":
      return splitThen(deps, open, lane, plan.card, plan.intent)
    case "send":
      return sendCard(
        deps,
        open,
        { card: plan.card, text: popped.text },
        plan.card,
      )
    case "relay":
      return deps.relay(lane, plan.relay)
    // Its record went with the pop: logged, and the queue goes on.
    case "skip":
      deps.basics.log(
        `[host] ${readThreadName(deps.basics.session, lane)}: a queued reference was skipped: its quote was not found`,
      )
      return "next"
  }
}

/**
 * A fact the host queued, appended to the thread: the lane is idle, since the
 * pop found it so. One that cannot be appended is logged and dropped: nobody
 * could send it from below the line.
 */
async function appendFact(
  deps: QueuedCardPopDeps,
  lane: ThreadId,
  fact: QueuedFact,
): Promise<"next"> {
  const { session, log, now } = deps.basics
  if (await deps.appendLaneless(lane, fact)) return "next"
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
 * A card that catches the thread up: the update, then the card's text sent, or
 * carried into the resolution run when the merge conflicts.
 */
async function catchUpThenSend(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  lane: ThreadId,
  popped: PoppedText,
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
    .catch(async (error: unknown) => {
      await unsent(deps, open, card, hostFailedWords(errorText(error)))
      return null
    })
  if (prepared === null) return "next"
  if (prepared.kind === "refused") {
    await unsent(deps, open, card, prepared.reason)
    return "next"
  }
  if (prepared.kind === "conflicted") {
    const runnable = deps.work.runnable(lane)
    if (typeof runnable === "object") {
      await unsent(deps, open, card, foreignLaneWords(runnable))
      return "next"
    }
    deps.start(runnable, {
      kind: "prompt",
      message: prepared.message,
      pinnedSeen: [],
    })
    return "ran"
  }
  if (plan.after === "discard") return "next"
  // Brought up to date: what is left is a plain message.
  return sendCard(deps, open, popped, {
    ...card,
    content: { ...card.content, command: null },
  })
}

/**
 * A card that splits the proposed changes: the split's own run, the card's text
 * its intent; refused, the card goes back below the line, saying why.
 */
async function splitThen(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  lane: ThreadId,
  card: QueuedText,
  intent: string,
): Promise<"ran" | "next"> {
  const message = await deps.work
    .prepareSplit(lane, card.place.by, intent)
    .catch((error: unknown) => ({
      refused: hostFailedWords(errorText(error)),
    }))
  if ("refused" in message) {
    await unsent(deps, open, card, message.refused)
    return "next"
  }
  const runnable = deps.work.runnable(lane)
  if (typeof runnable === "object") {
    await unsent(deps, open, card, foreignLaneWords(runnable))
    return "next"
  }
  deps.start(runnable, { kind: "prompt", message, pinnedSeen: [] })
  return "ran"
}

/** A popped card's text sent as its queuer's message; `sending` is what goes back if it cannot be. */
async function sendCard(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  popped: PoppedMessage,
  sending: QueuedMessage,
): Promise<"ran" | "next"> {
  const sent = await deps.send(popped).catch(async (error: unknown) => {
    await unsent(deps, open, sending, hostFailedWords(errorText(error)))
    return null
  })
  if (sent === null) return "next"
  switch (sent.kind) {
    // Spent: the change's close destroys a text card's text. A reference has
    // no text document; its quote's blob is swept.
    case "appended":
    case "started":
      return sent.kind === "started" ? "ran" : "next"
    case "busy":
      // A run started under the pop: the card goes back on top, as it was.
      open.apply([{ kind: "write", record: sending }])
      return "ran"
    case "refused":
      await unsent(deps, open, sending, sent.message)
      return "next"
    case "conflict":
      await unsent(
        deps,
        open,
        sending,
        "two threads end here: send it from one of them",
      )
      return "next"
    case "failed":
      await unsent(deps, open, sending, hostFailedWords(sent.message))
      return "next"
    default:
      await unsent(deps, open, sending, `not sent: ${sent.kind}`)
      return "next"
  }
}

/**
 * Write a card the host could not send back, whole, saying why: a note in
 * the column nearest its thread, or queued still behind a hold where it
 * has nowhere to go (`planUnsent`).
 */
async function unsent(
  deps: QueuedCardPopDeps,
  open: Pick<OpenChange, "apply">,
  card: QueuedMessage,
  reason: string,
): Promise<void> {
  const { session, places, log, newId, now } = deps.basics
  const plan = planUnsent({
    cards: readPlaces(places),
    card,
    reason,
    newColumn: () => cardIdOfKind("note-column", newId()),
  })
  // The hold first, so the drain this card ends finds the queue held.
  if (plan.hold)
    await deps.records.writeValues(
      planQueueHold({
        holds: readQueueHolds(session),
        lane: card.place.thread,
        by: card.place.by,
        now: now(),
        held: true,
      }),
    )
  open.apply(plan.steps)
  log(
    `[host] ${readThreadName(session, card.place.thread)}: a queued card was not sent: ${reason}`,
  )
}

/**
 * The waits for a queued card's text to give up (`behind`): each awaited card
 * no longer queued. The pop removed it, someone unqueued it, took it into an
 * inventory or discarded it, or its lane went: it will not be popped, so
 * nothing is left to wait for.
 */
export const givenUp = (
  awaited: Iterable<CardId>,
  cards: readonly CardRecord[],
): CardId[] => {
  const queued = new Set<CardId>(
    cards.filter(c => c.place.kind === "queued").map(c => c.id),
  )
  return [...awaited].filter(id => !queued.has(id))
}

/**
 * The drain's waits for its top card: once per card, until `until` resolves,
 * then drain its lane again. A wait is given up when its card leaves the queue
 * (`givenUp`), so no subscription outlives a card the pop will never reach. The
 * places are watched only while a wait is out. A card already awaited is not
 * awaited twice: the drain that follows the first wait asks again if it must.
 */
export function createWaits(deps: {
  readonly places: PlacesDocHandle
  readonly drain: (lane: ThreadId) => void
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
      if (!stop.signal.aborted) deps.drain(card.place.thread)
    })
  }
}

/**
 * Resolves once nobody is typing in `card` (`readTypingIn`), as soon as their
 * presence decays, or when `signal` gives the wait up.
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
