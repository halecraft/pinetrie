// host/commands/lane — the commands that act on one thread's lane: stop it,
// carry it on after a Stop, hold or release its queue, or act on its offer,
// which leaves a fact in the thread.

import {
  type AcceptedAction,
  cardIdOfKind,
  ERR,
  type ErrCode,
  type Intent,
  indexAsks,
  type LaneView,
  type OfferFact,
  type RootId,
  type ThreadId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readLanes,
  readParticipantNames,
  readPlaces,
  readPromptMessage,
  readQueueHolds,
  readRunningLanes,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  decodeRelay,
  displayName,
  planCarryOn,
  planFactCard,
  planQueueHold,
  planStop,
  QUEUE_HOLD,
  setRecord,
} from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import { type Basics, failed, type HostKeeper } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import { applyPlaceSteps } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

export interface LaneDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane">
  readonly records: Pick<Records, "writeValues">
  readonly work: Pick<LaneWork, "repo">
  readonly start: Runs["start"]
  /** Stop a chat's run that has not reached pi yet (`Runs.cancel`). */
  readonly cancel: Runs["cancel"]
  /** Drain a lane whose queue a card joined, unless it runs (`queueDrain`). */
  readonly drain: (lane: ThreadId) => void
  /** The documents' keeper: a fact's card is written in a step of its own. */
  readonly keeper: Pick<HostKeeper, "run">
  /** Each card's history: a fact's card is the host's write. */
  readonly provenance: Pick<Provenance, "before" | "after">
  /** Which queued cards are blank: they leave a lane idle. */
  readonly cards: Pick<CardPort, "blankQueued">
}

/** A thread's lane as its root's document has it now (`laneAt`). */
interface LaneHere {
  readonly root: RootId
  readonly doc: RootDocHandle
  readonly index: TreeIndex
  readonly lane: LaneView
}

/**
 * The lane's root's document, its tree and the lane's view; null for a lane no
 * root holds.
 */
async function laneAt(
  deps: Pick<LaneDeps, "basics" | "cards">,
  lane: ThreadId,
): Promise<LaneHere | null> {
  const { docs, live, places, session } = deps.basics
  const root = docs.rootOfLane(lane)
  if (root === null) return null
  const doc = await docs.root(root)
  const cards = readPlaces(places)
  const blank = await deps.cards.blankQueued(cards)
  const index = readTreeIndex(doc)
  const view = readLanes(
    { doc, live },
    index,
    cards,
    readQueueHolds(session),
    blank,
  ).find(l => l.name === lane)
  return view === undefined ? null : { root, doc, index, lane: view }
}

/**
 * Stop a thread's turn, queueing the fact of who stopped its ask first, and
 * holding its queue when a message card waits there: both are written before
 * the run is stopped, so they are there when the run's end drains the lane,
 * which then appends the fact and pops nothing else. A chat's run still waiting
 * for its pinned cards' text has not reached pi, whose abort would reach
 * nothing: it is cancelled instead. A take's stop is this one too, as the taker
 * (`onTaken`).
 */
export async function handleStop(
  deps: Pick<
    LaneDeps,
    "basics" | "cards" | "agent" | "records" | "cancel" | "provenance"
  >,
  lane: ThreadId,
  by: WriterId,
): Promise<Outcome> {
  const { agent } = deps
  const here = await laneAt(deps, lane)
  if (here === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  const { index } = here
  const { places, session, newId } = deps.basics
  const planned = planStop(here.lane, {
    index,
    asks: indexAsks(index),
    cards: readPlaces(places),
    holds: readQueueHolds(session),
    by,
    now: deps.basics.now(),
    id: cardIdOfKind("fact", newId()),
  })
  if (planned.kind === "abort") {
    if (planned.hold !== null)
      await deps.records.writeValues([setRecord(QUEUE_HOLD, planned.hold)])
    if (planned.fact.length > 0) {
      const before = deps.provenance.before()
      applyPlaceSteps(places, planned.fact)
      await deps.provenance.after({ kind: "host" }, before)
    }
    if (!deps.cancel(lane)) await agent.lane(lane).abort()
  }
  // A run this thread asked for in another thread stops with it.
  for (const asked of askedFrom(deps.basics, lane))
    await handleStop(deps, asked, by)
  return { kind: "stopped" }
}

/** The running lanes whose run another thread's ask from `lane` started. */
function askedFrom(
  basics: Pick<LaneDeps["basics"], "docs" | "session" | "live">,
  lane: ThreadId,
): readonly ThreadId[] {
  return readRunningLanes(basics.session, basics.live).flatMap(
    ({ lane: l }) => {
      if (l === lane) return []
      const doc = basics.docs.docOfLane(l)
      const prompt = doc === null ? null : readPromptMessage(doc, l)
      return prompt !== null && decodeRelay(prompt.message)?.from === lane
        ? [l]
        : []
    },
  )
}

/**
 * Hold a thread's queue, or release it, answering how the queue is now: `held`
 * or `released`, though it was already so. A release asks for the lane's drain:
 * nothing else would pop what waited.
 */
export async function handleQueueHold(
  deps: Pick<LaneDeps, "basics" | "cards" | "drain" | "records">,
  lane: ThreadId,
  held: boolean,
  by: WriterId,
): Promise<Outcome> {
  // gather
  const here = await laneAt(deps, lane)
  if (here === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such thread's queue",
    }
  // plan
  const writes = planQueueHold({
    holds: readQueueHolds(deps.basics.session),
    lane,
    by,
    now: deps.basics.now(),
    held,
  })
  // execute
  if (writes.length > 0) await deps.records.writeValues(writes)
  if (!held) deps.drain(lane)
  return { kind: held ? "held" : "released" }
}

/**
 * Carry on a thread whose last ask was stopped: a new run whose prompt is the
 * host's carry-on message, decided by `planCarryOn`. A step on the documents'
 * keeper, so a second press finds the lane busy.
 */
export async function handleCarryOn(
  deps: Pick<LaneDeps, "basics" | "cards" | "start">,
  lane: ThreadId,
  by: WriterId,
): Promise<Outcome> {
  const { basics } = deps
  const here = await laneAt(deps, lane)
  const planned = planCarryOn(
    here === null ? null : { ...here, asks: indexAsks(here.index) },
    {
      by,
      name: displayName(by, readParticipantNames(basics.session).get(by)),
      timestamp: basics.now(),
    },
  )
  if (planned.kind === "refused") return planned
  return {
    kind: "started",
    runId: deps.start(lane, {
      kind: "prompt",
      message: planned.message,
      pinnedSeen: [],
    }),
  }
}

/** An offer or accepted work's action on a host without tools: no repo to act on. */
const NO_REPO: Outcome = {
  kind: "refused",
  code: ERR.NOT_OWN_COPY,
  message: "this host has no lanes of their own",
}

/**
 * An offer action, the offer shell's, on your repo. A split is a card's
 * command, not an action.
 */
export async function actOnOffer(
  deps: LaneDeps,
  intent: Extract<Intent, { kind: "offer" }>,
  by: WriterId,
): Promise<Outcome> {
  const { lane, action, to, seen } = intent
  const { work } = deps
  if (work.repo === null) return NO_REPO
  const done = await work.repo.offers.act(lane, action, by, to, seen)
  if (done.kind === "refused")
    return {
      kind: "refused",
      code: done.code,
      message: offerRefusal(done.code),
    }
  // Off the command's reply: the fact is written in a keeper step of its own.
  void deps.keeper
    .run(() => recordFact(deps, done.fact))
    .catch(failed(deps.basics, "an offer's fact", lane))
  return action === "accept" ? { kind: "accepted" } : { kind: "offered" }
}

/**
 * What a command on an offer did, queued as a card on its thread and the lane's
 * drain asked for: an idle lane pops it at once, a running one when its run
 * ends, in order with the cards already waiting. One step: the card is written
 * against the places as they are, with its history.
 */
export async function recordFact(
  deps: Pick<LaneDeps, "basics" | "drain" | "provenance">,
  fact: OfferFact,
): Promise<void> {
  const { docs, places, newId, log } = deps.basics
  if (docs.rootOfLane(fact.lane) === null) return
  const before = deps.provenance.before()
  const steps = planFactCard({
    cards: readPlaces(places),
    id: cardIdOfKind("fact", newId()),
    fact,
  })
  // The host's own make is refused by no queue: should one be, it is said.
  if (steps === null) {
    log(`[host] a fact on ${fact.lane} was not queued: its card was refused`)
    return
  }
  applyPlaceSteps(places, steps)
  await deps.provenance.after({ kind: "host" }, before)
  deps.drain(fact.lane)
}

/** Why an offer action was refused, worded once. */
export function offerRefusal(code: ErrCode): string {
  switch (code) {
    case ERR.BAD_DESTINATION:
      return "the offer cannot be added there now: a conflicted offer goes only into a WIP, and the destination must sit below it"
    case ERR.OFFER_CHANGED:
      return "the offer changed since you looked at it: review it again"
    default:
      return "this thread has no offer in your repo"
  }
}

/**
 * A setup or publish: set up accepted work, or publish it.
 */
export async function actOnAccepted(
  deps: Pick<LaneDeps, "work">,
  action: AcceptedAction,
): Promise<Outcome> {
  const { repo } = deps.work
  if (repo === null) return NO_REPO
  const refused = await repo.accepted.act(action)
  return refused === null
    ? { kind: "accepted-moved" }
    : { kind: "refused", ...refused }
}
