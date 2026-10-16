// host/jj/proposed/describe — an agent's commit message for single proposed
// changes, by the host's describer (`host/describe.ts`): jj's gather and its
// settle.

import type { ThreadId } from "@pinetrie/core"
import {
  describeEffects,
  gatherDescribe,
  gatherProposedChanges,
} from "@pinetrie/jj"
import { planDescribeAsk, planDescribeSettle } from "@pinetrie/rules"
import type { Describe } from "../../describe.ts"
import { executeProposedChanges } from "./execute.ts"
import type { Refresh } from "./refresh.ts"
import type { ProposedChangesDeps } from "./state.ts"

/**
 * Gathered by a pinned read, which writes nothing: the proposed changes, its
 * diff and your recent messages (`planDescribeAsk`, `gatherDescribe`). Written
 * as an owner command, only while the proposed changes are still the one asked
 * about (`planDescribeSettle`). `force` asks again for proposed changes already
 * described.
 */
export function describe(
  deps: Pick<ProposedChangesDeps, "owner" | "docs"> & {
    readonly describer: Describe
  },
  refresh: Pick<Refresh, "ports">,
  lane: ThreadId,
  force: boolean,
): Promise<void> {
  const { owner, docs } = deps
  return deps.describer({
    lane,
    // The owner keeps the request in `idle`; its settle is a command.
    keeper: { run: step => step(), track: work => owner.track(work) },
    gather: () =>
      owner.read(async reads => {
        const asked = planDescribeAsk(
          await gatherProposedChanges(reads, docs.input(lane)),
          force,
        )
        if (asked === null) return null
        return { gathered: asked, ...(await gatherDescribe(reads, asked)) }
      }),
    settle: (asked, text, tip) =>
      owner.command(async ops => {
        // The proposed changes were rebuilt from its lane, or you edited it,
        // while the model wrote: the message describes what it held then.
        const planned = planDescribeSettle({
          gathered: await gatherProposedChanges(ops, docs.input(lane)),
          asked,
          force,
        })
        if (planned === null) return
        await executeProposedChanges(
          refresh.ports(ops, lane, planned.name),
          {
            base: null,
            effects: describeEffects(planned, text, {
              lane,
              name: planned.name,
              entry: tip ?? "",
            }),
          },
          null,
        )
      }),
  })
}
