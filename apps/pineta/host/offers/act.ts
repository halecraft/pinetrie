// host/offers/act — an offer action other than a split (ADR-0038): take,
// squash, refresh, or describe again. A take moves one bookmark forward to
// the offer (ADR-0060).

import {
  ERR,
  type ErrCode,
  type LaneName,
  type OfferSeen,
  type WriterId,
} from "@pineta/core"
import { commitsOf, revsetName } from "@pineta/lanes"
import { OFFER, setRecord, takeDestinations } from "@pineta/marginalia"
import { readThreadName } from "@pineta/reads"
import type { RepoOps } from "@pineta/repo"
import { describe } from "./describe.ts"
import { executeTake } from "./execute.ts"
import { changesOf, offerRecord, planTake } from "./plan.ts"
import { type Refresh, wipLine } from "./refresh.ts"
import type { OfferState } from "./state.ts"

export async function act(
  state: OfferState,
  refresh: Pick<Refresh, "rebuild" | "record">,
  lane: LaneName,
  action: "take" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
  seen: OfferSeen | null = null,
): Promise<ErrCode | null> {
  const done = await state.owner.command(ops => carry(ops))
  // After the command, so the description reads what it wrote. Tracked, and
  // logged on failure, by `requestOutside`.
  if (done.describe !== null) void describe(state, refresh, lane, done.describe)
  return done.code

  /** The command, and whether its offer is described after it: forced, or if wanted. */
  async function carry(ops: RepoOps): Promise<{
    readonly code: ErrCode | null
    readonly describe: boolean | null
  }> {
    const code = (c: ErrCode | null) => ({ code: c, describe: null })
    const { jj } = ops
    const { basics, line } = state
    const { session, docs, log } = basics
    // gather: the offer as your repo holds it, and where it sits
    const now = await state.offerNow(ops, lane)
    if (now === null || now.offer === null || now.name === undefined)
      return code(ERR.NO_OFFER)
    if (action === "describe") return { code: null, describe: true }
    const { place, name, offer } = now
    if (place.target === null) return code(ERR.BAD_DESTINATION)
    const at = { ...place, target: place.target }
    if (action === "take") {
      // A take that names no offer was shown none.
      if (seen === null) return code(ERR.OFFER_CHANGED)
      if (offer.kind === "divergent") return code(ERR.NO_OFFER)
      const [bottom] = offer.revisions
      if (bottom === undefined) return code(ERR.NO_OFFER)
      const { base } = place.base
      const wipAhead =
        base.kind === "wip"
          ? (
              await commitsOf(
                jj,
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
              jj,
              `present(${revsetName(d.bookmark)}) & ::parents(${bottom.commit})`,
            )
          ).length > 0
        )
          below.add(d.bookmark)
      const { editing } = await ops.shared()
      const takenAt = basics.now()
      // plan
      const planned = planTake({
        base: state.baseOf(lane, place),
        seen,
        offer,
        record: offerRecord({
          lane,
          name,
          offer,
          place,
          editing,
          now: takenAt,
        }),
        destinations,
        to,
        below: bookmark => below.has(bookmark),
        now: takenAt,
      })
      if (planned.kind === "refused") return code(planned.code)
      // execute
      await executeTake(
        {
          write: state.writeValues,
          run: steps => ops.execute(steps),
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
      return code(null)
    }
    // squash and refresh: the offer rebuilt from the lane's tip, as one.
    await refresh.rebuild(ops, lane, name, at, changesOf(offer), [
      {
        commit: place.tip,
        description: wipLine(docs.docOfLane(lane), lane, name),
      },
    ])
    return { code: null, describe: false }
  }
}
