// host/offers/act — an offer action other than a split (ADR-0038): take,
// squash, refresh, or describe again.

import { ERR, type ErrCode, type LaneName, type WriterId } from "@pineta/core"
import {
  commitsOf,
  executeOnHost,
  laneTipIn,
  planAbandonOffer,
  startOfOffer,
} from "@pineta/lanes"
import { readHaves, readThreadName } from "@pineta/reads"
import { failed } from "../basics.ts"
import { describe } from "./describe.ts"
import { executeTake } from "./execute.ts"
import { planTake } from "./plan.ts"
import { type Refresh, wipLine } from "./refresh.ts"
import type { OfferState } from "./state.ts"

export function act(
  state: OfferState,
  refresh: Pick<Refresh, "build" | "record">,
  lane: LaneName,
  action: "take" | "squash" | "describe" | "refresh",
  by: WriterId,
): Promise<ErrCode | null> {
  const { ops, root, basics } = state
  const { doc, log } = basics
  const describeLater = () =>
    void state.serial
      .track(describe(state, refresh, lane, false))
      .catch(failed(basics, "describing its offer", lane))
  if (action === "describe") {
    const o = state.offerOf(lane)
    if (o === undefined || o.taken !== null)
      return Promise.resolve(ERR.NO_OFFER)
    void state.serial
      .track(describe(state, refresh, lane, true))
      .catch(failed(basics, "describing its offer", lane))
    return Promise.resolve(null)
  }
  return state.serial.run(async () => {
    const o = state.offerOf(lane)
    if (o === undefined || o.taken !== null) return ERR.NO_OFFER
    const target = await state.targetNow()
    if (o.host.changes.length === 0) return ERR.NO_OFFER
    if (action === "take") {
      const under = await commitsOf(ops, `(${target}) & ::@`)
      const planned = planTake({
        root,
        lane,
        offer: o,
        target,
        underYou: under.length > 0,
        now: basics.now(),
      })
      if (planned === null) return ERR.NO_OFFER
      await executeTake(
        {
          run: executeOnHost,
          writeHave: have => state.writeHave(have),
          writeTaken: record =>
            state.agent().setWorkRecord({ kind: "offer", record }),
          taken: () => {
            log(
              `[host] ${readThreadName(doc, lane)}: offer taken by ${by} as ${(planned.taken.taken ?? "").slice(0, 8)}`,
            )
            state.taken()
          },
        },
        planned,
      )
      return null
    }
    // squash and refresh: the offer rebuilt from the lane's tip, as one.
    const name = state.nameOf(lane)
    if (name === undefined) return ERR.NO_OFFER
    await executeOnHost(planAbandonOffer(root, o.host.changes))
    const tip = (await laneTipIn(ops, lane)) ?? o.host.tip
    const start = await startOfOffer(ops, {
      tip,
      target,
      haves: readHaves(doc),
    })
    await refresh.build(
      lane,
      name,
      tip,
      start,
      target,
      [{ commit: tip, description: wipLine(doc, lane, name) }],
      false,
    )
    describeLater()
    return null
  })
}
