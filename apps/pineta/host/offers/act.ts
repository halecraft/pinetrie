// host/offers/act — an offer action other than a split (ADR-0038): take,
// squash, refresh, or describe again. A take moves one bookmark forward to
// the offer (ADR-0060).

import { ERR, type ErrCode, type LaneName, type WriterId } from "@pineta/core"
import {
  commitsOf,
  executeOnHost,
  revsetName,
  yourEditsIn,
} from "@pineta/lanes"
import { OFFER, setRecord, takeDestinations } from "@pineta/marginalia"
import { readThreadName } from "@pineta/reads"
import { describe } from "./describe.ts"
import { executeTake } from "./execute.ts"
import { changesOf, offerRecord, planTake } from "./plan.ts"
import { type Refresh, wipLine } from "./refresh.ts"
import type { OfferState } from "./state.ts"

export function act(
  state: OfferState,
  refresh: Pick<Refresh, "rebuild" | "record">,
  lane: LaneName,
  action: "take" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
): Promise<ErrCode | null> {
  const { ops, root, basics, line } = state
  const { session, docs, log } = basics
  // Tracked, and logged on failure, by `requestOutside`.
  const describeLater = () => void describe(state, refresh, lane, false)
  return state.serial.run(async () => {
    // gather: the offer as your repo holds it, and where it sits
    const now = await state.offerNow(lane)
    if (now === null || now.offer === null || now.name === undefined)
      return ERR.NO_OFFER
    if (action === "describe") {
      // Tracked, and logged on failure, by `requestOutside`.
      void describe(state, refresh, lane, true)
      return null
    }
    const { place, name, offer } = now
    if (place.target === null) return ERR.BAD_DESTINATION
    const at = { ...place, target: place.target }
    if (action === "take") {
      if (offer.kind === "divergent") return ERR.NO_OFFER
      const [bottom] = offer.revisions
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
        conflicted: offer.conflicts.length > 0,
        wipAhead,
      })
      const below = new Set<string>()
      for (const d of destinations)
        if (
          (
            await commitsOf(
              ops,
              `present(${revsetName(d.bookmark)}) & ::parents(${bottom.commit})`,
            )
          ).length > 0
        )
          below.add(d.bookmark)
      const yourEdits = await yourEditsIn(ops, offer.files)
      const takenAt = basics.now()
      // plan
      const planned = planTake({
        root,
        offer,
        record: offerRecord({
          lane,
          name,
          offer,
          place,
          yourEdits,
          now: takenAt,
        }),
        destinations,
        to,
        below: bookmark => below.has(bookmark),
        now: takenAt,
      })
      if (planned.kind === "refused") return planned.code
      // execute
      await executeTake(
        {
          run: executeOnHost,
          writeTaken: record =>
            state.agent().writeValues([setRecord(OFFER, record)]),
          taken: () => {
            log(
              `[host] ${readThreadName(session, lane)}: offer taken by ${by} as ${(planned.taken.taken ?? "").slice(0, 8)}`,
            )
            state.taken()
          },
        },
        planned,
      )
      return null
    }
    // squash and refresh: the offer rebuilt from the lane's tip, as one.
    await refresh.rebuild(lane, name, at, changesOf(offer), [
      {
        commit: place.tip,
        description: wipLine(docs.docOfLane(lane), lane, name),
      },
    ])
    describeLater()
    return null
  })
}
