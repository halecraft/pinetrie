// host/commands/lane — the commands that act on one thread's lane: stop it,
// or act on its offer (ADR-0038).

import {
  ERR,
  type ErrCode,
  type Intent,
  indexAsks,
  isBusy,
  type LaneName,
  type LaneView,
  type LineAction,
  type RootId,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLanes,
  readParticipantNames,
  readPlaces,
  readStops,
  readTreeIndex,
} from "@pineta/reads"
import {
  displayName,
  planCarryOn,
  planStop,
  STOP,
  setRecord,
} from "@pineta/rules"
import type { RootDocHandle } from "@pineta/schema"
import type { Basics } from "../basics.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

export interface LaneDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane" | "writeValues">
  readonly work: Pick<LaneWork, "offers" | "line" | "prepareSplit">
  readonly start: Runs["start"]
  /** Stop a chat's run that has not reached pi yet (`Runs.cancel`). */
  readonly cancel: Runs["cancel"]
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
  basics: Pick<Basics, "docs" | "live" | "places">,
  lane: LaneName,
): Promise<LaneHere | null> {
  const { docs, live, places } = basics
  const root = docs.rootOfLane(lane)
  if (root === null) return null
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  const view = readLanes({ doc, live }, index, readPlaces(places)).find(
    l => l.name === lane,
  )
  return view === undefined ? null : { root, doc, index, lane: view }
}

/**
 * Stop a thread's turn, recording who stopped its ask first (ADR-0056): the
 * record is written before the run is stopped, so it is there when the
 * run's end is drawn. A chat's run still waiting for its pinned cards' text
 * has not reached pi, whose abort would reach nothing: it is cancelled
 * instead. The run's end then drains the lane, as any run's does.
 */
export async function handleStop(
  deps: Pick<LaneDeps, "basics" | "agent" | "cancel">,
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
  const planned = planStop(here.lane, {
    index,
    stops: readStops(doc),
    by,
    now: deps.basics.now(),
  })
  if (planned.kind === "abort") {
    if (planned.record !== null)
      await agent.writeValues([setRecord(STOP, planned.record, root)])
    if (!deps.cancel(lane)) await agent.lane(lane).abort()
  }
  return { kind: "stopped" }
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
 * An offer action (ADR-0038). A split is a run on the lane, so a busy lane
 * refuses it; every other action is the offer shell's, on your repo.
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
  if (action === "split") {
    const view = (await laneAt(deps.basics, lane))?.lane
    if (view === undefined || isBusy(view))
      return {
        kind: "refused",
        code: ERR.BUSY,
        message: "the thread is working: split its offer when it stops",
      }
    const message = await work.prepareSplit(lane, by)
    if ("refused" in message)
      return { kind: "refused", code: ERR.REFUSED, message: message.refused }
    return {
      kind: "started",
      runId: deps.start(lane, { kind: "prompt", message, pinnedSeen: [] }),
    }
  }
  const refused = await offers.act(lane, action, by, to, seen)
  if (refused !== null)
    return { kind: "refused", code: refused, message: offerRefusal(refused) }
  return action === "take" ? { kind: "taken" } : { kind: "offered" }
}

/** Why an offer action was refused, worded once. */
export function offerRefusal(code: ErrCode): string {
  switch (code) {
    case ERR.BAD_DESTINATION:
      return "the offer cannot be taken there now: a conflicted offer goes only into a WIP, and the destination must sit below it"
    case ERR.OFFER_CHANGED:
      return "the offer changed since you looked at it: review it again"
    default:
      return "this thread has no offer in your repo"
  }
}

/**
 * A `line` command: set up the integration line, land your work (ADR-0060),
 * update your files from it (ADR-0061), or publish it (ADR-0076).
 */
export async function actOnLine(
  deps: Pick<LaneDeps, "work">,
  action: LineAction,
): Promise<Outcome> {
  const { line } = deps.work
  if (line === null)
    return {
      kind: "refused",
      code: ERR.NOT_OWN_COPY,
      message: "this host has no lanes of their own",
    }
  const refused = await line.act(action)
  return refused === null
    ? { kind: "line-moved" }
    : { kind: "refused", ...refused }
}
