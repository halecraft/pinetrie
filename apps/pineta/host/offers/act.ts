// host/offers/act — an offer action other than a split (ADR-0038): take,
// squash, refresh, or describe again. Each is one owner command: gather
// (`gatherOffer`, and `gatherTake` for a take), decide (`planOfferTake`,
// `planRebuild`), translate and execute. A take moves one bookmark forward
// to the offer (ADR-0060).

import type { ErrCode, LaneName, OfferSeen, WriterId } from "@pineta/core"
import { readThreadName } from "@pineta/reads"
import {
  gatherOffer,
  gatherTake,
  type RepoOps,
  takeEffects,
} from "@pineta/repo"
import { planDescribeAgain, planOfferTake, planRebuild } from "@pineta/rules"
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
  action: "take" | "squash" | "describe" | "refresh",
  by: WriterId,
  to: string | null = null,
  seen: OfferSeen | null = null,
): Promise<ErrCode | null> {
  const { owner, line, basics, docs } = deps
  const done = await owner.command(ops => carry(ops))
  // After the command, so the description reads what it wrote. Tracked, and
  // logged on failure, by `requestOutside`.
  if (done.describe !== null) void describe(deps, refresh, lane, done.describe)
  return done.code

  /** The command, and whether its offer is described after it: forced, or if wanted. */
  async function carry(ops: RepoOps): Promise<{
    readonly code: ErrCode | null
    readonly describe: boolean | null
  }> {
    const code = (c: ErrCode | null) => ({ code: c, describe: null })
    // gather
    const gathered = await gatherOffer(ops, docs.input(lane))
    if (action === "describe") {
      const refused = planDescribeAgain(gathered)
      return refused === null ? { code: null, describe: true } : code(refused)
    }
    if (action === "take") {
      const take =
        gathered === null ? null : await gatherTake(ops, gathered, line)
      const { editing } = await ops.shared()
      // plan
      const planned = planOfferTake({
        lane,
        gathered,
        seen,
        take,
        editing,
        onto: line.onto,
        to,
        now: basics.now(),
      })
      if (planned.kind === "refused") return code(planned.code)
      // execute: the lane's base record first, as the take found it.
      await executeOffer(
        refresh.ports(ops, lane, planned.name),
        { base: gathered?.base ?? null, effects: takeEffects(planned) },
        null,
      )
      basics.log(
        `[host] ${readThreadName(basics.session, lane)}: offer taken by ${by} as ${planned.top.slice(0, 8)}`,
      )
      return code(null)
    }
    // squash and refresh: the offer rebuilt from the lane's tip, as one.
    const name = gathered?.name
    const planned = planRebuild(
      gathered,
      name === undefined ? "" : docs.wipLine(lane, name),
    )
    if (planned.kind === "refused") return code(planned.why)
    await refresh.rebuild(ops, lane, planned)
    return { code: null, describe: false }
  }
}
