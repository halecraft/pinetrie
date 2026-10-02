// host/offers/act — an offer action other than a split (ADR-0038): take,
// squash, refresh, or describe again. A take moves one bookmark forward to
// the offer (ADR-0060).

import { ERR, type ErrCode, type LaneName, type WriterId } from "@pineta/core"
import {
  commitsOf,
  executeOnHost,
  planAbandonOffer,
  revsetName,
} from "@pineta/lanes"
import { takeDestinations } from "@pineta/marginalia"
import { readThreadName } from "@pineta/reads"
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
  to: string | null = null,
): Promise<ErrCode | null> {
  const { ops, root, basics, line } = state
  const { doc, log } = basics
  // Tracked, and logged on failure, by `requestOutside`.
  const describeLater = () => void describe(state, refresh, lane, false)
  if (action === "describe") {
    const o = state.offerOf(lane)
    if (o === undefined || o.taken !== null)
      return Promise.resolve(ERR.NO_OFFER)
    void describe(state, refresh, lane, true)
    return Promise.resolve(null)
  }
  return state.serial.run(async () => {
    const o = state.offerOf(lane)
    if (o === undefined || o.taken !== null) return ERR.NO_OFFER
    if (o.host.changes.length === 0) return ERR.NO_OFFER
    const place = await state.placeOf(lane)
    if (place === null) return ERR.NO_OFFER
    if (action === "take") {
      // gather: the offer as it is, where it may go, and what is below it
      if (place.target === null) return ERR.BAD_DESTINATION
      const facts = await state.factsOf(o, place.target)
      const [bottom] = facts.commits
      if (bottom === undefined) return ERR.NO_OFFER
      const { base } = place.base
      const wipAhead =
        base.kind === "wip"
          ? (
              await commitsOf(
                ops,
                `::present(${revsetName(base.bookmark)}) ~ ::present(${revsetName(line.onto)})`,
              )
            ).length
          : 0
      const destinations = takeDestinations({
        base,
        state: place.state,
        onto: line.onto,
        conflicted: facts.conflicts.length > 0,
        wipAhead,
      })
      const below = new Set<string>()
      for (const d of destinations)
        if (
          (
            await commitsOf(
              ops,
              `present(${revsetName(d.bookmark)}) & ::parents(${bottom})`,
            )
          ).length > 0
        )
          below.add(d.bookmark)
      // plan
      const planned = planTake({
        root,
        offer: o,
        destinations,
        to,
        below: bookmark => below.has(bookmark),
        now: basics.now(),
      })
      if (planned.kind === "refused") return planned.code
      // execute
      await executeTake(
        {
          run: executeOnHost,
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
    if (name === undefined || place.target === null) return ERR.NO_OFFER
    await executeOnHost(planAbandonOffer(root, o.host.changes))
    await refresh.build(
      lane,
      name,
      place.tip,
      place.start,
      place.target,
      [{ commit: place.tip, description: wipLine(doc, lane, name) }],
      false,
    )
    describeLater()
    return null
  })
}
