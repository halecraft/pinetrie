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
  atEntry,
  type BlobStore,
  errorText,
  type RootId,
  type Sha256,
  type Spot,
  type ThreadId,
} from "@pinetrie/core"
import type { Agent, Scribe } from "@pinetrie/pi"
import {
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readRunning,
  readThreadName,
  readThreads,
  readTreeIndex,
  readTypingIn,
} from "@pinetrie/reads"
import {
  type CarryPlan,
  displayName,
  encodeFact,
  foreignLaneWords,
  mintContainer,
  planCarry,
  planQueuedPop,
  planQueueHold,
  planUnsent,
  type QueuedCard,
  type QueuedMessage,
  type QueuedText,
  queuedOn,
  queuedTextCards,
  threadSetAside,
} from "@pinetrie/rules"
import type { PlacesDocHandle, PresenceDocHandle } from "@pinetrie/schema"
import {
  type CardId,
  type CardRecord,
  cardTextSource,
  parseMentions,
  type QueuedFact,
  type RelayDetails,
  type Send,
  type TextCardId,
  threadEnd,
} from "@pinetrie/threads"
import { notWritten, type StepBasics } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { SendOutcome } from "./commands/send.ts"
import type { OpenChange, Places } from "./places.ts"
import type { Records } from "./records.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work/index.ts"
import type { LaneGate } from "./work/memory-holds.ts"

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
 * typing in, only blank cards, a lane whose start the machine holds, a top
 * card whose text is behind, or a card popped.
 */
export type NextQueuedCardPop =
  | { readonly kind: "idle" }
  | { readonly kind: "held" }
  | { readonly kind: "typing"; readonly card: QueuedText }
  | { readonly kind: "blank"; readonly card: QueuedText }
  | { readonly kind: "start-held"; readonly card: QueuedCard }
  | { readonly kind: "behind"; readonly card: QueuedText }
  | { readonly kind: "popped"; readonly popped: PoppedQueuedCard }

/**
 * Pop a lane's next queued card: read that it is queued and on top, read its
 * text, and remove its record. Synchronous: an unqueue is a step on the same
 * keeper as the drain, so it runs before the pop or after it, never between,
 * and one after it is refused as gone. Idle when the lane runs or nothing is
 * queued; `held`, `typing`, `blank` and `start-held` as
 * `planNextQueuedCardPop` says. A card
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
  facts: Pick<
    Parameters<typeof planQueuedPop>[0],
    "running" | "away" | "held" | "typing" | "isStartHeld"
  >,
  texts: Pick<CardPort, "textNow" | "holds">,
  quotes: ReadonlyMap<Sha256, string> = new Map(),
): NextQueuedCardPop {
  const cards = readPlaces(places)
  const step = planQueuedPop({
    ...facts,
    cards,
    lane,
    texts: new Map(
      queuedTextCards(cards, lane).map(card => [
        card.id,
        {
          text: texts.textNow(card.id),
          current: texts.holds(card.id, card.place.seen),
        },
      ]),
    ),
    quotes,
  })
  if (step.kind !== "pop") return step
  open.apply([step.step])
  return { kind: "popped", popped: { card: step.card, text: step.text } }
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
  /** The drain's step's: a fact for a thread with no lane reads its root. */
  readonly basics: Pick<
    StepBasics,
    "session" | "live" | "places" | "docs" | "roots" | "log" | "now" | "newId"
  >
  /** A queue's hold, written when an unsent card has nowhere to go. */
  readonly records: Pick<Records, "writeValues">
  /** Who is typing in which card (`typingIn`): the pop waits for them. */
  readonly presence: PresenceDocHandle
  readonly texts: Pick<CardPort, "hydrate" | "textNow" | "holds">
  /** Where a fact is appended, in a thread with a lane. */
  readonly agent: Pick<Agent, "lane">
  /** Where a fact is appended, in a thread with no lane: only a lane appends. */
  readonly scribe: Pick<Scribe, "appendToTree">
  readonly work: Pick<
    LaneWork,
    "prepareUpdate" | "prepareSplit" | "runnable" | "hasOwnContainer"
  >
  /** Whether the machine lets a lane start now: the pop waits while it does not. */
  readonly machine: Pick<LaneGate, "isLaneActivityAllowed">
  /** Start a run in the drain's step, whose documents lease its root. */
  readonly start: (
    ...args: Parameters<Runs["start"]> extends [unknown, ...infer R] ? R : never
  ) => ReturnType<Runs["start"]>
  /** Send a popped card's text as its queuer's message, through the gate and `sendMessage`. */
  readonly send: (popped: PoppedMessage) => Promise<SendOutcome>
  /** Where a queued reference's quote is read. */
  readonly blobs: Pick<BlobStore, "get">
  /** The top card's text is behind: drain the lane again once the host holds it. */
  readonly behind: (card: QueuedText) => void
  /** Someone is typing in the top card: drain the lane again once they stop. */
  readonly typing: (card: QueuedText) => void
  /** Only blank cards are queued: drain the lane again once `card` is written in. */
  readonly blank: (card: QueuedText) => void
  /** The machine holds the lane's start: drain it again once it lets the lane start. */
  readonly startHeld: (card: QueuedCard) => void
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
}

/**
 * Pop a lane's queued cards in order until one starts a run or none is left.
 * Each card's text is loaded before the pop, so the pop reads it whole. A
 * popped card is spent once its message is written or running; one that could
 * not be sent goes back below the line, saying why (`planUnsent`). A held queue
 * ends the drain; a top card whose text is behind, or that someone types in,
 * ends it with a wait that drains again; so does a queue of blank cards alone,
 * until one is written in, and a lane whose start the machine holds, read
 * before the pop or answered by the card's start, until it lets the lane
 * start. A run's end, startup, a move that queues a card on an idle lane, and
 * a release each drain again.
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
          // A pop runs in its own thread: in an inventory or a trash, it has
          // no runner, and a lane of another kind runs nothing. The gate
          // refuses both at its send.
          away:
            threadSetAside(readPlaces(places), lane) !== null ||
            typeof deps.work.runnable(lane) === "object",
          held: readQueueHolds(deps.basics.session).has(lane),
          typing: readTypingIn(deps.presence),
          // A lane with no container of its own starts none, so is never held.
          isStartHeld:
            deps.work.hasOwnContainer(lane) &&
            !deps.machine.isLaneActivityAllowed(lane, "container-start"),
        },
        deps.texts,
        quotes,
      )
      return next.kind === "popped"
        ? ({
            kind: "carried",
            card: next.popped.card,
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
    if (top.kind === "start-held") return deps.startHeld(top.card)
    // Put back on top by its carrying: the queue waits for the start.
    if (top.done === "start-held") return deps.startHeld(top.card)
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
 * What carrying out a popped card came to: "ran", a run started, whose end
 * drains again; "next", the next card's turn; "start-held", the machine held
 * the lane's start, and the card is back on top.
 */
type Carried = "ran" | "next" | "start-held"

/**
 * One popped card, carried out as `planCarry` decides. The pop deleted its
 * record, so a throw while it is carried out writes it back too, or the card
 * would be lost.
 */
async function carryOut(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  lane: ThreadId,
  popped: PoppedQueuedCard,
): Promise<Carried> {
  const plan = planCarry(popped.card, popped.text)
  switch (plan.kind) {
    case "fact":
      return appendFact(deps, lane, plan.fact)
    case "get-latest":
      return getLatestThenSend(
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
 * Where a fact goes in `thread` when it has no lane (a chat an agent was
 * asked from): its end, in its root. Null for a thread with a lane, which
 * appends its own, and for one with no record or no entry.
 */
export async function lanelessSpot(
  basics: Pick<StepBasics, "session" | "docs" | "roots">,
  thread: ThreadId,
): Promise<Spot | null> {
  if (basics.docs.rootOfLane(thread) !== null) return null
  const root = readThreads(basics.session).get(thread)?.root
  if (root === undefined) return null
  const end = threadEnd(readTreeIndex(await basics.roots.root(root)), thread)
  return end === null ? null : { root, at: atEntry(end) }
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
  const { session, now } = deps.basics
  const message = encodeFact(
    fact,
    displayName(fact.by, readParticipantNames(session).get(fact.by)),
    now(),
  )
  const spot = await lanelessSpot(deps.basics, lane)
  const appended = await (spot === null
    ? deps.agent.lane(lane).append(message)
    : deps.scribe.appendToTree(message, spot, lane)
  ).catch((error: unknown) => ({
    kind: "failed" as const,
    message: errorText(error),
  }))
  notWritten(deps.basics, "a fact", lane)(appended)
  return "next"
}

/**
 * A card that catches the thread up: the update, then the card's text sent, or
 * carried into the resolution run when the merge conflicts. A lane whose start
 * the machine holds merges nothing, and the card goes back on top, as it was.
 */
async function getLatestThenSend(
  deps: QueuedCardPopDeps,
  open: OpenChange,
  lane: ThreadId,
  popped: PoppedText,
  plan: Extract<CarryPlan, { readonly kind: "get-latest" }>,
): Promise<Carried> {
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
  if (prepared.kind === "start-held") {
    open.apply([{ kind: "write", record: card }])
    return "start-held"
  }
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
  if (plan.after === "trash") return "next"
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
): Promise<Carried> {
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
    case "start-held":
      // It got the latest first, and the machine held the lane's start.
      open.apply([{ kind: "write", record: sending }])
      return "start-held"
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
    newContainer: mintContainer(newId),
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
 * inventory or trashed it, or its lane went: it will not be popped, so
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
