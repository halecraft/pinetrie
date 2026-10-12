// host/offers/act — an offer action other than a split: accept, squash,
// refresh, or describe again. Each is one owner command: gather (`gatherOffer`,
// and `gatherOfferAcceptance` for an acceptance), decide
// (`planOfferAcceptance`, `planRebuild`), translate and execute. An acceptance
// moves one bookmark forward to the offer. An action carried out answers with
// its fact, what the thread is told it did.

import {
  ERR,
  type ErrCode,
  type OfferFact,
  type OfferSeen,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { readThreadName } from "@pinetrie/reads"
import {
  gatherOffer,
  gatherOfferAcceptance,
  offerAcceptanceEffects,
  type RepoOps,
} from "@pinetrie/repo"
import {
  acceptedFact,
  actionFact,
  planDescribeAgain,
  planOfferAcceptance,
  planRebuild,
} from "@pinetrie/rules"
import { describe } from "./describe.ts"
import { executeOffer } from "./execute.ts"
import type { Refresh } from "./refresh.ts"
import type { OfferDeps } from "./state.ts"

export async function act(
  deps: Pick<
    OfferDeps,
    "owner" | "repoConfig" | "basics" | "docs" | "piSetup" | "running"
  > & { readonly describing: Set<ThreadId> },
  refresh: Pick<Refresh, "rebuild" | "ports">,
  lane: ThreadId,
  action: "accept" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
  seen: OfferSeen | null = null,
): Promise<
  | { readonly kind: "refused"; readonly code: ErrCode }
  | { readonly kind: "done"; readonly fact: OfferFact }
> {
  const { owner, repoConfig, basics, docs } = deps
  const done = await owner.command(ops => carry(ops))
  // After the command, so the description reads what it wrote. Tracked, and
  // logged on failure, by `requestOutside`.
  if (done.describe !== null) void describe(deps, refresh, lane, done.describe)
  return done.fact === null
    ? { kind: "refused", code: done.code ?? ERR.REFUSED }
    : { kind: "done", fact: done.fact }

  /**
   * The command, whether its offer is described after it (forced, or if
   * wanted), and its fact: null when it was refused.
   */
  async function carry(ops: RepoOps): Promise<{
    readonly code: ErrCode | null
    readonly describe: boolean | null
    readonly fact: OfferFact | null
  }> {
    const code = (c: ErrCode) => ({ code: c, describe: null, fact: null })
    // gather
    const gathered = await gatherOffer(ops, docs.input(lane))
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
          : await gatherOfferAcceptance(ops, gathered, repoConfig)
      const { editing } = await ops.shared()
      // plan
      const planned = planOfferAcceptance({
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
      await executeOffer(
        refresh.ports(ops, lane, planned.name),
        {
          base: gathered?.base ?? null,
          effects: offerAcceptanceEffects(planned),
        },
        null,
      )
      basics.log(
        `[host] ${readThreadName(basics.session, lane)}: offer accepted by ${by} as ${planned.top.slice(0, 8)}`,
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
    // squash and refresh: the offer rebuilt from the lane's tip, as one.
    const name = gathered?.name
    const planned = planRebuild(
      gathered,
      name === undefined ? "" : docs.wipLine(lane, name),
    )
    if (planned.kind === "refused") return code(planned.why)
    await refresh.rebuild(ops, lane, planned)
    return { code: null, describe: false, fact: actionFact(action, lane, by) }
  }
}
