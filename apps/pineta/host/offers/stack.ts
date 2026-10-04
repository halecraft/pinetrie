// host/offers/stack — a split's stack (ADR-0038): where it starts and ends,
// and whether the stack a split's run made may replace the offer.

import type { CommitId, LaneName } from "@pineta/core"
import { commitsOf, lines } from "@pineta/lanes"
import { acceptStack } from "@pineta/marginalia"
import type { OfferSource } from "@pineta/repo"
import { changesOf } from "./plan.ts"
import type { Refresh } from "./refresh.ts"
import type { OfferState } from "./state.ts"

/** Where a split's stack starts and ends: the offer's start and the lane's tip. */
export function stackSpan(
  state: OfferState,
  lane: LaneName,
): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null> {
  return state.owner.command(async ops => {
    const place = await state.placeOf(ops, lane)
    return place === null || place.start.kind !== "known"
      ? null
      : { start: [...place.start.start], tip: place.tip }
  })
}

/**
 * A split's run ended: its stack, fetched into your repo as `stack`, replaces
 * the offer if it holds exactly the lane tip's files. Returns why not.
 */
export function stackEnded(
  state: OfferState,
  refresh: Pick<Refresh, "rebuild">,
  lane: LaneName,
  stack: {
    readonly start: readonly CommitId[]
    readonly tip: CommitId
    readonly top: CommitId | null
  },
): Promise<string | null> {
  return state.owner.command(async ops => {
    const { jj } = ops
    if (stack.top === null) return "the stack's bookmark was not set"
    const revisions = await commitsOf(
      jj,
      `(${stack.start.join(" | ")})..${stack.top}`,
    )
    const differing = lines(
      (
        await jj([
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
        await jj(["log", "--no-graph", "-r", commit, "-T", "description"])
      ).stdout
      sources.push({ commit, description })
    }
    const now = await state.offerNow(ops, lane)
    if (now === null) return "the thread's lane is not in your repo"
    const { place, name, offer } = now
    if (name === undefined) return "the thread has no name yet"
    if (place.target === null)
      return "the thread's base is gone: continue it on the line"
    // The stack was made from this tip and start: its ledger names them.
    await refresh.rebuild(
      ops,
      lane,
      name,
      { ...place, tip: stack.tip, start: stack.start, target: place.target },
      offer === null ? [] : changesOf(offer),
      sources,
    )
    return null
  })
}
