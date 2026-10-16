// Divergent proposed changes repaired in your favour: the one step on proposed
// changes that read between its steps. Abandoning the host's commit of one
// change rebases the host's commits above it, so each change's commits are read
// only once the step before it has run: a commit id read before an earlier
// rewrite names a hidden commit, and acting on it forks the change.

import type { RepoOps } from "./owner.ts"
import { planRepair } from "./plan.ts"
import { hostCommitIn, hostVersionOf } from "./proposed.ts"

/**
 * Each of proposed changes' divergent changes, bottom first: the host's commit
 * abandoned and yours kept, the proposed changes' bookmark set to your top. A
 * change that is not exactly one of each is left as it is.
 */
export async function repairProposedChanges(
  ops: Pick<RepoOps, "jj" | "execute">,
  input: { readonly bookmark: string; readonly changeIds: readonly string[] },
): Promise<void> {
  const last = input.changeIds.length - 1
  // A repair moves the bookmark, never the host's version: read it once.
  const host = await hostVersionOf(ops.jj, input.bookmark)
  for (const [i, changeId] of input.changeIds.entries()) {
    const split = await hostCommitIn(ops.jj, changeId, host)
    if (split === null) continue
    await ops.execute(
      planRepair({ bookmark: input.bookmark, ...split, top: i === last }),
    )
  }
}
