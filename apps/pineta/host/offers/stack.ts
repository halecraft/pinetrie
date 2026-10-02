// host/offers/stack — a split's stack (ADR-0038): where it starts and ends,
// and whether the stack a split's run made may replace the offer.

import type { CommitId, LaneName } from "@pineta/core"
import {
  commitsOf,
  executeOnHost,
  lines,
  type OfferSource,
  planAbandonOffer,
} from "@pineta/lanes"
import { acceptStack } from "@pineta/marginalia"
import type { Refresh } from "./refresh.ts"
import type { OfferState } from "./state.ts"

/** Where a split's stack starts and ends: the offer's start and the lane's tip. */
export function stackSpan(
  state: OfferState,
  lane: LaneName,
): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null> {
  return state.serial.run(async () => {
    const place = await state.placeOf(lane)
    return place === null ? null : { start: [...place.start], tip: place.tip }
  })
}

/**
 * A split's run ended: its stack, fetched into your repo as `stack`, replaces
 * the offer if it holds exactly the lane tip's files. Returns why not.
 */
export function stackEnded(
  state: OfferState,
  refresh: Pick<Refresh, "build">,
  lane: LaneName,
  stack: {
    readonly start: readonly CommitId[]
    readonly tip: CommitId
    readonly top: CommitId | null
  },
): Promise<string | null> {
  const { ops, root } = state
  return state.serial.run(async () => {
    if (stack.top === null) return "the stack's bookmark was not set"
    const revisions = await commitsOf(
      ops,
      `(${stack.start.join(" | ")})..${stack.top}`,
    )
    const differing = lines(
      (
        await ops([
          "diff",
          "--from",
          stack.tip,
          "--to",
          stack.top,
          "--name-only",
        ])
      ).stdout,
    )
    const verdict = acceptStack({ revisions: revisions.length, differing })
    if (!verdict.ok) return verdict.reason
    const sources: OfferSource[] = []
    for (const commit of revisions.toReversed()) {
      const description = (
        await ops(["log", "--no-graph", "-r", commit, "-T", "description"])
      ).stdout
      sources.push({ commit, description })
    }
    const name = state.nameOf(lane)
    if (name === undefined) return "the thread has no name yet"
    const place = await state.placeOf(lane)
    if (place === null || place.target === null)
      return "the thread's base is gone: continue it on the line"
    const { target } = place
    const o = state.offerOf(lane)
    if (o !== undefined && o.taken === null)
      await executeOnHost(planAbandonOffer(root, o.host.changes))
    await refresh.build(
      lane,
      name,
      stack.tip,
      stack.start,
      target,
      sources,
      true,
    )
    return null
  })
}
