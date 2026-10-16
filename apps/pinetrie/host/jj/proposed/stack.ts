// host/jj/proposed/stack — a split's stack: where it starts and ends, and
// whether the stack a split's run made may replace the proposed changes
// (`planStackEnded`).

import type { CommitId, ThreadId } from "@pinetrie/core"
import { gatherPlace, gatherProposedChanges, gatherStack } from "@pinetrie/jj"
import { planStackEnded } from "@pinetrie/rules"
import type { Refresh } from "./refresh.ts"
import type { ProposedChangesDeps } from "./state.ts"

/** Where a split's stack starts and ends: the proposed changes' start and the lane's tip; null where nothing is built. */
export function stackSpan(
  deps: Pick<ProposedChangesDeps, "owner" | "docs">,
  lane: ThreadId,
): Promise<{ readonly start: CommitId[]; readonly tip: CommitId } | null> {
  return deps.owner.command(async ops => {
    const place = await gatherPlace(ops, deps.docs.input(lane))
    return place?.kind === "placed"
      ? { start: [...place.start], tip: place.tip }
      : null
  })
}

/**
 * A split's run ended: its stack, fetched into your repo as `stack`, replaces
 * the proposed changes if it holds exactly the lane tip's files. Returns why
 * not.
 */
export function stackEnded(
  deps: Pick<ProposedChangesDeps, "owner" | "docs">,
  refresh: Pick<Refresh, "rebuild">,
  lane: ThreadId,
  stack: {
    readonly start: readonly CommitId[]
    readonly tip: CommitId
    readonly top: CommitId | null
  },
): Promise<string | null> {
  return deps.owner.command(async ops => {
    // gather
    const facts = await gatherStack(ops, stack)
    const gathered = await gatherProposedChanges(ops, deps.docs.input(lane))
    // plan
    const planned = planStackEnded({ stack, facts, gathered })
    if (planned.kind === "refused") return planned.why
    // execute: the stack was made from this tip and start, and its ledger names them.
    await refresh.rebuild(ops, lane, planned)
    return null
  })
}
