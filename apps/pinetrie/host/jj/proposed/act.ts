// host/jj/proposed/act — an action on proposed changes other than a split:
// accept, squash, refresh, or describe again. Each is one owner command: gather
// (`gatherProposedChanges`, and `gatherAcceptance` for an acceptance), decide
// (`planAcceptance`, `planRebuild`), translate and execute. An acceptance moves
// one bookmark forward to the proposed changes. An action carried out answers
// with its fact, what the thread is told it did.

import {
  ERR,
  type ErrCode,
  type ProposedChangesSeen,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  acceptanceEffects,
  gatherAcceptance,
  gatherProposedChanges,
  type RepoOps,
} from "@pinetrie/jj"
import { readThreadName } from "@pinetrie/reads"
import { planProposedAct, shortId } from "@pinetrie/rules"
import type { ProposedChangesFact } from "@pinetrie/threads"
import type { Describe } from "../../describe.ts"
import { describe } from "./describe.ts"
import { executeProposedChanges } from "./execute.ts"
import type { Refresh } from "./refresh.ts"
import type { ProposedChangesDeps } from "./state.ts"

export async function act(
  deps: Pick<
    ProposedChangesDeps,
    "owner" | "repoConfig" | "basics" | "docs" | "piSetup" | "running"
  > & { readonly describer: Describe },
  refresh: Pick<Refresh, "rebuild" | "ports">,
  lane: ThreadId,
  action: "accept" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
  seen: ProposedChangesSeen | null = null,
): Promise<
  | { readonly kind: "refused"; readonly code: ErrCode }
  | { readonly kind: "done"; readonly fact: ProposedChangesFact }
> {
  const { owner, repoConfig, basics, docs } = deps
  const done = await owner.command(ops => carry(ops))
  // After the command, so the description reads what it wrote. Tracked, and
  // logged on failure, by `describe`.
  if (done.describe !== null) void describe(deps, refresh, lane, done.describe)
  return done.fact === null
    ? { kind: "refused", code: done.code ?? ERR.REFUSED }
    : { kind: "done", fact: done.fact }

  /**
   * The command, whether its proposed changes are described after it (forced,
   * or if wanted), and its fact: null when it was refused. Gathered for its
   * action, planned once (`planProposedAct`), carried out.
   */
  async function carry(ops: RepoOps): Promise<{
    readonly code: ErrCode | null
    readonly describe: boolean | null
    readonly fact: ProposedChangesFact | null
  }> {
    // gather
    const gathered = await gatherProposedChanges(ops, docs.input(lane))
    const base = { lane, by, gathered }
    const rebuilds = action === "squash" || action === "refresh"
    const message =
      !rebuilds || gathered?.name === undefined
        ? { entry: "", unfinished: "" }
        : await docs.messageFacts(lane, gathered.name)
    // plan
    const planned =
      action === "accept"
        ? planProposedAct({
            ...base,
            action,
            seen,
            acceptance:
              gathered === null
                ? null
                : await gatherAcceptance(ops, gathered, repoConfig),
            editing: (await ops.shared()).editing,
            acceptedBookmark: repoConfig.acceptedBookmark,
            to,
            now: basics.now(),
          })
        : action === "describe"
          ? planProposedAct({ ...base, action })
          : planProposedAct({ ...base, action, unfinished: message.unfinished })
    // execute
    switch (planned.kind) {
      case "refused":
        return { code: planned.code, describe: null, fact: null }
      case "describe":
        return { code: null, describe: true, fact: planned.fact }
      case "accept":
        // The lane's base record first, as the acceptance found it.
        await executeProposedChanges(
          refresh.ports(ops, lane, planned.decision.name),
          {
            base: gathered?.base ?? null,
            effects: acceptanceEffects(planned.decision),
          },
          null,
        )
        basics.log(
          `[host] ${readThreadName(basics.session, lane)}: proposed changes accepted by ${by} as ${shortId(planned.decision.top)}`,
        )
        return { code: null, describe: null, fact: planned.fact }
      case "rebuild":
        await refresh.rebuild(ops, lane, planned.rebuild, message.entry)
        return { code: null, describe: false, fact: planned.fact }
    }
  }
}
