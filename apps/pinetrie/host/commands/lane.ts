// host/commands/lane — the commands that act on one thread's lane: stop it,
// carry it on after a Stop (ADR-0082), hold or release its queue (ADR-0048
// step 7), or act on its offer (ADR-0105), which leaves a fact in the thread
// (ADR-0080).

import {
  type AcceptedAction,
  atEntry,
  cardId,
  ERR,
  type ErrCode,
  type Intent,
  indexAsks,
  type LaneName,
  type LaneView,
  type OfferFact,
  type RootId,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import type { Agent } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readLanes,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readStops,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  displayName,
  planCarryOn,
  planFactCard,
  planQueueHold,
  planStop,
  QUEUE_HOLD,
  queuedOn,
  STOP,
  setRecord,
} from "@pinetrie/rules"
import { type RootDocHandle, readLaneTip } from "@pinetrie/schema"
import { type Basics, failed, type HostKeeper } from "../basics.ts"
import { applyPlaceSteps } from "../places.ts"
import type { Provenance } from "../provenance.ts"
import type { Records } from "../records.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

export interface LaneDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane">
  readonly records: Pick<Records, "writeValues">
  readonly work: Pick<LaneWork, "offers" | "accepted">
  readonly start: Runs["start"]
  /** Stop a chat's run that has not reached pi yet (`Runs.cancel`). */
  readonly cancel: Runs["cancel"]
  /** Drain a lane whose queue a card joined, unless it runs (`queueDrain`). */
  readonly drain: (lane: LaneName) => void
  /** The documents' keeper: a fact's card is written in a step of its own. */
  readonly keeper: Pick<HostKeeper, "run">
  /** Each card's history: a fact's card is the host's write. */
  readonly provenance: Pick<Provenance, "before" | "after">
}

/** A thread's lane as its root's document has it now (`laneAt`). */
interface LaneHere {
  readonly root: RootId
  readonly doc: RootDocHandle
  readonly index: TreeIndex
  readonly lane: LaneView
}

/**
 * The lane's root's document (ADR-0063), its tree and the lane's view; null
 * for a lane no root holds.
 */
async function laneAt(
  basics: Pick<Basics, "docs" | "live" | "places" | "session">,
  lane: LaneName,
): Promise<LaneHere | null> {
  const { docs, live, places, session } = basics
  const root = docs.rootOfLane(lane)
  if (root === null) return null
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  const view = readLanes(
    { doc, live },
    index,
    readPlaces(places),
    readQueueHolds(session),
  ).find(l => l.name === lane)
  return view === undefined ? null : { root, doc, index, lane: view }
}

/**
 * Stop a thread's turn, recording who stopped its ask first (ADR-0106), and
 * holding its queue when a message card waits there (ADR-0048 step 7):
 * both are written before the run is stopped, so they are there when the
 * run's end is drawn and drains the lane, which then pops nothing. A chat's
 * run still waiting for its pinned cards' text has not reached pi, whose
 * abort would reach nothing: it is cancelled instead.
 */
export async function handleStop(
  deps: Pick<LaneDeps, "basics" | "agent" | "records" | "cancel">,
  lane: LaneName,
  by: WriterId,
): Promise<Outcome> {
  const { agent } = deps
  const here = await laneAt(deps.basics, lane)
  if (here === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  const { root, doc, index } = here
  const { places, session } = deps.basics
  const planned = planStop(here.lane, {
    index,
    stops: readStops(doc),
    queue: queuedOn(readPlaces(places), lane),
    holds: readQueueHolds(session),
    by,
    now: deps.basics.now(),
  })
  if (planned.kind === "abort") {
    const writes = [
      ...(planned.record === null
        ? []
        : [setRecord(STOP, planned.record, root)]),
      ...(planned.hold === null ? [] : [setRecord(QUEUE_HOLD, planned.hold)]),
    ]
    if (writes.length > 0) await deps.records.writeValues(writes)
    if (!deps.cancel(lane)) await agent.lane(lane).abort()
  }
  return { kind: "stopped" }
}

/**
 * Hold a thread's queue, or release it (ADR-0048 step 7), answering how the
 * queue is now: `held` or `released`, though it was already so. A release
 * asks for the lane's drain: nothing else would pop what waited.
 */
export async function handleQueueHold(
  deps: Pick<LaneDeps, "basics" | "drain" | "records">,
  lane: LaneName,
  held: boolean,
  by: WriterId,
): Promise<Outcome> {
  // gather
  const here = await laneAt(deps.basics, lane)
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
 * Carry on a thread whose last ask was stopped (ADR-0082): a new run whose
 * prompt is the host's carry-on message, decided by `planCarryOn`. A step on
 * the documents' keeper, so a second press finds the lane busy.
 */
export async function handleCarryOn(
  deps: Pick<LaneDeps, "basics" | "start">,
  lane: LaneName,
  by: WriterId,
): Promise<Outcome> {
  const { basics } = deps
  const here = await laneAt(basics, lane)
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

/**
 * An offer action (ADR-0105), the offer shell's, on your repo. A split is a
 * card's command, not an action (ADR-0080).
 */
export async function actOnOffer(
  deps: LaneDeps,
  intent: Extract<Intent, { kind: "offer" }>,
  by: WriterId,
): Promise<Outcome> {
  const { lane, action, to, seen } = intent
  const { work } = deps
  const offers = work.offers
  if (offers === null)
    return {
      kind: "refused",
      code: ERR.NOT_OWN_COPY,
      message: "this host has no lanes of their own",
    }
  const done = await offers.act(lane, action, by, to, seen)
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
 * What a command on an offer did, queued as a card on its thread (ADR-0080)
 * and the lane's drain asked for: an idle lane pops it at once, a running
 * one when its run ends, in order with the cards already waiting. One step:
 * the card is written against the places as they are, with its history.
 */
export async function recordFact(
  deps: Pick<LaneDeps, "basics" | "drain" | "provenance">,
  fact: OfferFact,
): Promise<void> {
  const { docs, places, newId } = deps.basics
  const root = docs.rootOfLane(fact.lane)
  if (root === null) return
  const tip = readLaneTip(await docs.root(root), fact.lane)
  if (tip === null) return
  const before = deps.provenance.before()
  applyPlaceSteps(places, [
    planFactCard({
      cards: readPlaces(places),
      id: cardId(newId()),
      fact,
      root,
      at: atEntry(tip),
    }),
  ])
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
 * A setup or publish: set up accepted work (ADR-0104), or publish it
 * (ADR-0076, ADR-0090).
 */
export async function actOnAccepted(
  deps: Pick<LaneDeps, "work">,
  action: AcceptedAction,
): Promise<Outcome> {
  const { accepted } = deps.work
  if (accepted === null)
    return {
      kind: "refused",
      code: ERR.NOT_OWN_COPY,
      message: "this host has no lanes of their own",
    }
  const refused = await accepted.act(action)
  return refused === null
    ? { kind: "accepted-moved" }
    : { kind: "refused", ...refused }
}
