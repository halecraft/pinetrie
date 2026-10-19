// host/jj/proposed/act — an action on proposed changes other than a split:
// accept, squash, refresh, or describe again. Each is one owner command: gather
// (`gatherProposedChanges`, and `gatherAcceptance` for an acceptance), decide
// (`planAcceptance`, `planRebuild`), translate and execute. An acceptance moves
// one bookmark forward to the proposed changes. An action carried out answers
// with its fact, what the thread is told it did.

import {
  ERR,
  type ErrCode,
  type ProposedChangesFact,
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
import {
  acceptedFact,
  actionFact,
  planAcceptance,
  planDescribeAgain,
  planRebuild,
  shortId,
} from "@pinetrie/rules"
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
   * or if wanted), and its fact: null when it was refused.
   */
  async function carry(ops: RepoOps): Promise<{
    readonly code: ErrCode | null
    readonly describe: boolean | null
    readonly fact: ProposedChangesFact | null
  }> {
    const code = (c: ErrCode) => ({ code: c, describe: null, fact: null })
    // gather
    const gathered = await gatherProposedChanges(ops, docs.input(lane))
    if (action === "describe") {
      const refused = planDescribeAgain(gathered)
      return refused === null
        ? {
            code: null,
            describe: true,
            fact: actionFact("describe", lane, by),
          }
        : code(refused)
    }
    if (action === "accept") {
      const acceptance =
        gathered === null
          ? null
          : await gatherAcceptance(ops, gathered, repoConfig)
      const { editing } = await ops.shared()
      // plan
      const planned = planAcceptance({
        lane,
        gathered,
        seen,
        acceptance,
        editing,
        acceptedBookmark: repoConfig.acceptedBookmark,
        to,
        now: basics.now(),
      })
      if (planned.kind === "refused") return code(planned.code)
      // execute: the lane's base record first, as the acceptance found it.
      await executeProposedChanges(
        refresh.ports(ops, lane, planned.name),
        {
          base: gathered?.base ?? null,
          effects: acceptanceEffects(planned),
        },
        null,
      )
      basics.log(
        `[host] ${readThreadName(basics.session, lane)}: proposed changes accepted by ${by} as ${shortId(planned.top)}`,
      )
      return {
        code: null,
        describe: null,
        fact: acceptedFact({
          lane,
          by,
          decision: planned,
          acceptedBookmark: repoConfig.acceptedBookmark,
        }),
      }
    }
    // squash and refresh: the proposed changes rebuilt from the lane's tip, as
    // one.
    const name = gathered?.name
    const message =
      name === undefined
        ? { entry: "", unfinished: "" }
        : await docs.messageFacts(lane, name)
    const planned = planRebuild(gathered, message.unfinished)
    if (planned.kind === "refused") return code(planned.why)
    await refresh.rebuild(ops, lane, planned, message.entry)
    return { code: null, describe: false, fact: actionFact(action, lane, by) }
  }
}
