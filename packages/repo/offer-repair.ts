// repo/offer-repair — a divergent offer repaired in your favour (S48 items
// 2 and 8).
//
// The one offer step that reads between its steps, and must: abandoning the
// host's commit of one change rebases the host's commits above it, so each
// change's commits are read only once the step before it has run. A step
// that named a commit read before an earlier rewrite would act on a hidden
// commit and fork the change (S48 item 2). Each change's split is decided by
// `hostCommitIn`'s read, and its steps by `planRepair`.

import { hostCommitIn } from "./offer.ts"
import type { RepoOps } from "./owner.ts"
import { planRepair } from "./plan.ts"

/**
 * Each of an offer's divergent changes, bottom first: the host's commit
 * abandoned and yours kept, the offer's bookmark set to your top. A change
 * that is not exactly one of each is left as it is.
 */
export async function repairOffer(
  ops: Pick<RepoOps, "jj" | "execute">,
  input: { readonly bookmark: string; readonly changes: readonly string[] },
): Promise<void> {
  const last = input.changes.length - 1
  for (const [i, change] of input.changes.entries()) {
    const split = await hostCommitIn(ops.jj, change)
    if (split === null) continue
    await ops.execute(
      planRepair({ bookmark: input.bookmark, ...split, top: i === last }),
    )
  }
}
