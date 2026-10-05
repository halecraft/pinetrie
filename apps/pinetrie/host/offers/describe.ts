// host/offers/describe — an agent's commit message for a single offer
// (ADR-0038): a one-shot model request outside the thread.

import { type LaneName, projectTranscript } from "@pinetrie/core"
import { readTreeIndex } from "@pinetrie/reads"
import { describeEffects, gatherDescribe, gatherOffer } from "@pinetrie/repo"
import {
  describeRequest,
  planDescribeAsk,
  planDescribeSettle,
  transcriptLines,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { failed } from "../basics.ts"
import { requestOutside } from "../outside.ts"
import { executeOffer } from "./execute.ts"
import type { Refresh } from "./refresh.ts"
import type { OfferDeps } from "./state.ts"

/** A commit message request's size: the skill, recent messages, the thread, the diff. */
const DESCRIBE_BUDGET = 24_000

/**
 * Gathered by a pinned read, which writes nothing (S87): the offer, its diff
 * and your recent messages (`planDescribeAsk`, `gatherDescribe`). Asked
 * outside the owner (a model request takes seconds), and written as an
 * owner command, only while the offer is still the one asked about
 * (`planDescribeSettle`). One request per lane at a time (`describing`), so
 * two settles of one lane never meet. `force` asks again for an offer
 * already described. A failure is logged.
 */
export function describe(
  deps: Pick<OfferDeps, "owner" | "basics" | "docs" | "piSetup"> & {
    readonly describing: Set<LaneName>
  },
  refresh: Pick<Refresh, "ports">,
  lane: LaneName,
  force: boolean,
): Promise<void> {
  const { owner, describing, docs } = deps
  const fail = failed(deps.basics, "describing its offer", lane)
  if (describing.has(lane)) return Promise.resolve()
  describing.add(lane)
  return owner.track(
    owner
      .read(async reads => {
        // gather
        const asked = planDescribeAsk(
          await gatherOffer(reads, docs.input(lane)),
          force,
        )
        if (asked === null) return null
        return { commit: asked, ...(await gatherDescribe(reads, asked)) }
      })
      .then(gathered => {
        if (gathered === null) return
        const doc = deps.basics.docs.docOfLane(lane)
        const tip = doc === null ? null : readLaneTip(doc, lane)
        return requestOutside({
          // The owner keeps the request in `idle`; its settle is a command.
          keeper: { run: step => step(), track: work => owner.track(work) },
          failed: fail,
          request: async () => {
            const messages = transcriptLines(
              doc === null ? [] : projectTranscript(readTreeIndex(doc), tip),
            )
            const skill = await deps.piSetup.skill(
              "pinetrie:skill:commit-message",
            )
            return deps.piSetup.complete(
              describeRequest({
                skill:
                  skill?.content ?? "Write a commit message for this change.",
                diff: gathered.diff,
                messages,
                recent: gathered.recent,
                budget: DESCRIBE_BUDGET,
              }),
            )
          },
          settle: text =>
            owner.command(async ops => {
              // The offer was rebuilt from its lane, or you edited it, while
              // the model wrote: the message describes what it held then.
              const planned = planDescribeSettle({
                gathered: await gatherOffer(ops, docs.input(lane)),
                asked: gathered.commit,
                force,
              })
              if (planned === null) return
              await executeOffer(
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
      })
      .catch(fail)
      .finally(() => describing.delete(lane)),
  )
}
