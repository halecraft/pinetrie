// host/offers/describe — an agent's commit message for a single offer
// (ADR-0038): a one-shot model request outside the thread.

import { type LaneName, projectTranscript } from "@pineta/core"
import { executeOnHost, planDescribe, titlesOf } from "@pineta/lanes"
import {
  describeRequest,
  describeWanted,
  offerMessage,
  transcriptLines,
} from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { readLaneTip } from "@pineta/schema"
import { failed } from "../basics.ts"
import { requestOutside } from "../outside.ts"
import type { Refresh } from "./refresh.ts"
import type { OfferState } from "./state.ts"

/** A commit message request's size: the skill, recent messages, the thread, the diff. */
const DESCRIBE_BUDGET = 24_000

/**
 * Gathered from your repo on the queue, since a jj read can write (S57):
 * the offer, its diff and your recent messages. Asked outside it (a model
 * request takes seconds), and written inside it, only while the offer is
 * still the one asked about (`describeWanted`, and the same commit).
 * `force` asks again for an offer already described. A failure is logged.
 */
export function describe(
  state: OfferState,
  refresh: Pick<Refresh, "record">,
  lane: LaneName,
  force: boolean,
): Promise<void> {
  const { ops, root, serial } = state
  const { docs } = state.basics
  const fail = failed(state.basics, "describing its offer", lane)
  return serial
    .run(async () => {
      // gather
      const now = await state.offerNow(lane)
      if (now === null || now.name === undefined) return null
      const { offer, name } = now
      if (!describeWanted(offer, name, force)) return null
      const [revision] = offer.revisions
      if (revision === undefined) return null
      const diff = (
        await ops(["diff", "-r", revision.commit, "--git"]).catch(() => null)
      )?.stdout
      const recent = await titlesOf(ops, "ancestors(@-, 20)").catch(() => [])
      return { commit: revision.commit, diff: diff ?? "", recent }
    })
    .then(gathered => {
      if (gathered === null) return
      const doc = docs.docOfLane(lane)
      const tip = doc === null ? null : readLaneTip(doc, lane)
      return requestOutside({
        serial,
        failed: fail,
        request: async () => {
          const messages = transcriptLines(
            doc === null ? [] : projectTranscript(readTreeIndex(doc), tip),
          )
          const skill = await state.agent().skill("pineta:skill:commit-message")
          return state.agent().complete(
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
        settle: async text => {
          // The offer followed its lane, or you edited it, while the model
          // wrote: the message describes what it held then.
          const now = await state.offerNow(lane)
          if (now === null || now.name === undefined) return
          const { offer, name, place } = now
          if (!describeWanted(offer, name, force)) return
          const [revision] = offer.revisions
          if (revision === undefined || revision.commit !== gathered.commit)
            return
          await executeOnHost(
            planDescribe(
              root,
              revision.change,
              offerMessage(text, {
                lane,
                name,
                entry: tip ?? "",
                ledger: offer.ledger ?? {
                  source: place.tip,
                  start: place.start,
                },
              }),
            ),
          )
          const after = await state.offerNow(lane)
          if (after !== null && after.name !== undefined)
            await refresh.record(lane, after.name, after.place, after.offer)
        },
      })
    })
    .catch(fail)
}
