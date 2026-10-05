// host/offers/act — an offer action other than a split (ADR-0038):
// integrate, squash, refresh, or describe again. Each is one owner command:
// gather (`gatherOffer`, and `gatherOfferIntegration` for an integration),
// decide (`planOfferIntegration`, `planRebuild`), translate and execute. An
// offer integration moves one bookmark forward to the offer (ADR-0060). An
// action carried out answers with its fact, what the thread is told it did
// (ADR-0080).

import {
  ERR,
  type ErrCode,
  type LaneName,
  type OfferFact,
  type OfferSeen,
  type WriterId,
} from "@pinetrie/core"
import { readThreadName } from "@pinetrie/reads"
import {
  gatherOffer,
  gatherOfferIntegration,
  offerIntegrationEffects,
  type RepoOps,
} from "@pinetrie/repo"
import {
  actionFact,
  integratedFact,
  planDescribeAgain,
  planOfferIntegration,
  planRebuild,
} from "@pinetrie/rules"
import { describe } from "./describe.ts"
import { executeOffer } from "./execute.ts"
import type { Refresh } from "./refresh.ts"
import type { OfferDeps } from "./state.ts"

export async function act(
  deps: Pick<
    OfferDeps,
    "owner" | "line" | "basics" | "docs" | "agent" | "running"
  > & { readonly describing: Set<LaneName> },
  refresh: Pick<Refresh, "rebuild" | "ports">,
  lane: LaneName,
  action: "integrate" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
  seen: OfferSeen | null = null,
): Promise<
  | { readonly kind: "refused"; readonly code: ErrCode }
  | { readonly kind: "done"; readonly fact: OfferFact }
> {
  const { owner, line, basics, docs } = deps
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
    if (action === "integrate") {
      const integration =
        gathered === null
          ? null
          : await gatherOfferIntegration(ops, gathered, line)
      const { editing } = await ops.shared()
      // plan
      const planned = planOfferIntegration({
        lane,
        gathered,
        seen,
        integration,
        editing,
        onto: line.onto,
        to,
        now: basics.now(),
      })
      if (planned.kind === "refused") return code(planned.code)
      // execute: the lane's base record first, as the integration found it.
      await executeOffer(
        refresh.ports(ops, lane, planned.name),
        {
          base: gathered?.base ?? null,
          effects: offerIntegrationEffects(planned),
        },
        null,
      )
      basics.log(
        `[host] ${readThreadName(basics.session, lane)}: offer integrated by ${by} as ${planned.top.slice(0, 8)}`,
      )
      return {
        code: null,
        describe: null,
        fact: integratedFact({ lane, by, decision: planned, onto: line.onto }),
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
