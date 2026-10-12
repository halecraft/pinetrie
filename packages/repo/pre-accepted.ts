// Once, as a starting host's first command on your repo: the bookmark
// `pinetrie-onto` renamed `pinetrie-accepted`, and the `immutable_heads()`
// setup wrote in your repo's config rewritten to name it. Each write is
// planned from what the repo holds, so a start that stopped between them
// finishes the other. Delete this file, its test and its call
// (`apps/pinetrie/host/work/setup.ts`) once Duane's repo has passed it.

import { commitsOf, DEFAULT_REPO, revsetName } from "@pinetrie/lanes"
import type { RepoOps } from "./owner.ts"
import { acceptedHeads } from "./plan.ts"
import { host, type RepoStep, you } from "./step.ts"

/** Accepted work's bookmark before it was renamed. */
export const OLD_ACCEPTED = "pinetrie-onto"

/** What the rename is planned from, read from your repo and the config. */
export interface AcceptedRenameFacts {
  /** The bookmark the config names for accepted work. */
  readonly configured: string
  /** Whether `pinetrie-onto` is a bookmark in your repo. */
  readonly old: boolean
  /** Whether the configured bookmark is one. */
  readonly current: boolean
  /** Your repo's `immutable_heads()`; null for jj's builtin. */
  readonly heads: string | null
}

/**
 * The rename's steps and what the host says of them. Only with the default
 * bookmark configured: a config that names its own was chosen, and is left
 * as it is.
 */
export function planAcceptedRename(facts: AcceptedRenameFacts): {
  readonly steps: readonly RepoStep[]
  readonly lines: readonly string[]
} {
  const { configured } = facts
  if (configured !== DEFAULT_REPO.acceptedBookmark)
    return { steps: [], lines: [] }
  const steps: RepoStep[] = []
  const lines: string[] = []
  if (facts.old && !facts.current) {
    steps.push(host("bookmark", "rename", OLD_ACCEPTED, configured))
    lines.push(
      `renamed ${OLD_ACCEPTED} to ${configured} in your repo; jj op revert undoes it`,
    )
  } else if (facts.old)
    lines.push(
      `your repo has both ${OLD_ACCEPTED} and ${configured}: accepted work is ${configured}, so move or delete ${OLD_ACCEPTED} in jj`,
    )
  const oldHeads = acceptedHeads(OLD_ACCEPTED)
  const heads = facts.heads?.trim() ?? null
  if (heads?.endsWith(oldHeads)) {
    steps.push(
      you(
        "config",
        "set",
        "--repo",
        'revset-aliases."immutable_heads()"',
        `${heads.slice(0, -oldHeads.length)}${acceptedHeads(configured)}`,
      ),
    )
    lines.push(
      `your repo's immutable_heads() now names ${configured} (jj config set --repo undoes it)`,
    )
  }
  if (steps.length > 0)
    lines.push(
      `if jjui has a revset of its own naming ${OLD_ACCEPTED}, name ${configured} there instead`,
    )
  return { steps, lines }
}

/**
 * Gather, plan and carry out the rename, as one owner command: the lines it
 * returns say what it did.
 */
export async function renameAccepted(
  ops: Pick<RepoOps, "jj" | "execute">,
  configured: string,
): Promise<readonly string[]> {
  const exists = async (name: string) =>
    (await commitsOf(ops.jj, `present(${revsetName(name)})`)).length > 0
  const heads = await ops.jj([
    "config",
    "get",
    'revset-aliases."immutable_heads()"',
  ])
  const planned = planAcceptedRename({
    configured,
    old: await exists(OLD_ACCEPTED),
    current: await exists(configured),
    heads: heads.ok ? heads.stdout.trim() : null,
  })
  if (planned.steps.length > 0) await ops.execute(planned.steps)
  return planned.lines
}
