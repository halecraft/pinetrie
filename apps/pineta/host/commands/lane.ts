// host/commands/lane — the commands that act on one thread's lane: stop it,
// or act on its offer (ADR-0038).

import {
  ERR,
  type ErrCode,
  isBusy,
  type LaneName,
  type LineAction,
  type OfferAction,
  planStop,
  type WriterId,
} from "@pineta/core"
import { STOP, setRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLane,
  readLanes,
  readPlaces,
  readStops,
  readTreeIndex,
} from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

export interface LaneDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "lane" | "writeValues">
  readonly work: Pick<LaneWork, "offers" | "prepareSplit">
  readonly start: Runs["start"]
}

/**
 * Stop a thread's turn, recording who stopped its ask first (ADR-0056): the
 * record is written before pi is asked to abort, so it is there when the
 * run's end is drawn. The run's end then drains the lane, as any run's does.
 */
export async function handleStop(
  deps: Pick<LaneDeps, "basics" | "agent">,
  lane: LaneName,
  by: WriterId,
): Promise<Outcome> {
  const { agent } = deps
  const { docs, live, places, now } = deps.basics
  // The lane's root's document (ADR-0063); a lane no root holds is unknown.
  const root = docs.rootOfLane(lane)
  if (root === null)
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  const doc = await docs.root(root)
  const index = readTreeIndex(doc)
  const planned = planStop(
    readLanes({ doc, live }, index, readPlaces(places)),
    lane,
    {
      index,
      stops: readStops(doc),
      by,
      now: now(),
    },
  )
  if (planned.kind === "unknown")
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  if (planned.kind === "abort") {
    if (planned.record !== null)
      await agent.writeValues([setRecord(STOP, planned.record, root)])
    await agent.lane(lane).abort()
  }
  return { kind: "stopped" }
}

/**
 * An offer action (ADR-0038). A split is a run on the lane, so a busy lane
 * refuses it; every other action is the offer shell's, on your repo.
 */
export async function actOnOffer(
  deps: LaneDeps,
  lane: LaneName,
  action: OfferAction,
  by: WriterId,
  to: string | null = null,
): Promise<Outcome> {
  const { work } = deps
  const offers = work.offers
  if (offers === null)
    return {
      kind: "refused",
      code: ERR.NOT_OWN_COPY,
      message: "this host has no lanes of their own",
    }
  if (action === "split") {
    const { docs, live, places } = deps.basics
    const root = docs.rootOfLane(lane)
    const view =
      root === null
        ? undefined
        : readLane(
            { doc: await docs.root(root), live },
            lane,
            readPlaces(places),
          )
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
      runId: deps.start(lane, { kind: "prompt", message }),
    }
  }
  const refused = await offers.act(lane, action, by, to)
  if (refused !== null)
    return { kind: "refused", code: refused, message: offerRefusal(refused) }
  return action === "take" ? { kind: "taken" } : { kind: "offered" }
}

/** Why an offer action was refused, worded once. */
export function offerRefusal(code: ErrCode): string {
  return code === ERR.BAD_DESTINATION
    ? "the offer cannot be taken there now: a conflicted offer goes only into a WIP, and the destination must sit below it"
    : "this thread has no offer in your repo"
}

/** Why a `line` command was refused, worded once (ADR-0060). */
export function lineRefusal(action: LineAction, code: ErrCode): string {
  switch (code) {
    case ERR.NOT_YOURS:
      return "this host admits others, so it does not act on the repo as its owner: use jj on its machine"
    case ERR.NO_LINE:
      return "set up the line first"
    default:
      switch (action) {
        case "setup":
          return "the line is already set up"
        case "land":
          return "your @- is not above the line: rebase onto it first"
        case "follow":
          return "your files have nothing to take from the project, or share no commit with it"
      }
  }
}

/**
 * A `line` command: set up the integration line, land your work (ADR-0060),
 * or update your files from it (ADR-0061).
 */
export async function actOnLine(
  deps: Pick<LaneDeps, "work">,
  action: LineAction,
): Promise<Outcome> {
  const offers = deps.work.offers
  if (offers === null)
    return {
      kind: "refused",
      code: ERR.NOT_OWN_COPY,
      message: "this host has no lanes of their own",
    }
  const refused = await offers.line(action)
  return refused === null
    ? { kind: "line-moved" }
    : { kind: "refused", code: refused, message: lineRefusal(action, refused) }
}
