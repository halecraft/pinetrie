// host/commands/lane — the commands that act on one thread's lane: stop it,
// update it from your work, or act on its offer (ADR-0038).

import {
  ERR,
  isBusy,
  type LaneName,
  type OfferAction,
  planStop,
  type WriterId,
} from "@pineta/core"
import { planUpdate } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLane,
  readLaneRecords,
  readLanes,
  readStops,
  readThreadName,
  readTreeIndex,
} from "@pineta/reads"
import type { Basics } from "../basics.ts"
import type { Runs } from "../runs.ts"
import type { LaneWork } from "../work/index.ts"

export interface LaneDeps {
  readonly basics: Basics
  readonly agent: Pick<Agent, "hold" | "lane" | "setStop">
  readonly work: Pick<LaneWork, "offers" | "prepareSplit" | "prepareUpdate">
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
  const { doc, now } = deps.basics
  const index = readTreeIndex(doc)
  const planned = planStop(readLanes(doc, index), lane, {
    index,
    stops: readStops(doc),
    by,
    now: now(),
  })
  if (planned.kind === "unknown")
    return {
      kind: "refused",
      code: ERR.UNKNOWN_TARGET,
      message: "no such lane to stop",
    }
  if (planned.kind === "abort") {
    if (planned.record !== null)
      await agent.setStop(planned.record.prompt, planned.record.value)
    await agent.lane(lane).abort()
  }
  return { kind: "stopped" }
}

/**
 * An update (ADR-0038): a busy lane holds it, as it would a message;
 * otherwise a copy of your work is merged into the lane. Clean: a fact in
 * the thread, and the composer's prefill. Conflicted: the resolution runs
 * (ADR-0033).
 */
export async function startUpdate(
  deps: LaneDeps,
  lane: LaneName,
  by: WriterId,
): Promise<Outcome> {
  const { agent, work } = deps
  const { doc, log, newId, now } = deps.basics
  const planned = planUpdate({
    record: readLaneRecords(doc).get(lane),
    view: readLane(doc, lane),
  })
  if (planned.kind === "refused")
    return {
      kind: "refused",
      code: planned.code,
      message: "only a thread with its own copy takes your work",
    }
  if (planned.kind === "hold") {
    await agent.hold({
      kind: "update",
      id: newId(),
      lane,
      by,
      timestamp: now(),
    })
    return { kind: "queued", position: planned.position }
  }
  const updated = await work.prepareUpdate(lane, by)
  if ("refused" in updated) {
    log(
      `[host] ${readThreadName(doc, lane)}: update refused: ${updated.refused}`,
    )
    return { kind: "refused", code: ERR.REFUSED, message: updated.refused }
  }
  if (updated.kind === "conflicted")
    return {
      kind: "started",
      runId: deps.start(lane, { kind: "prompt", message: updated.message }),
    }
  return {
    kind: "updated",
    text: updated.kind === "clean" ? updated.prefill : "",
  }
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
    const view = readLane(deps.basics.doc, lane)
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
  const refused = await offers.act(lane, action, by)
  if (refused !== null)
    return {
      kind: "refused",
      code: refused,
      message: "this thread has no offer in your repo",
    }
  return action === "take" ? { kind: "taken" } : { kind: "offered" }
}
