// host/offers/describe — an agent's commit message for a single offer
// (ADR-0038): a one-shot model request outside the thread.

import { type LaneName, projectTranscript } from "@pineta/core"
import { titlesOf } from "@pineta/lanes"
import {
  describeRequest,
  describeWanted,
  offerMessage,
  transcriptLines,
} from "@pineta/marginalia"
import { readTreeIndex } from "@pineta/reads"
import { planDescribe } from "@pineta/repo"
import { readLaneTip } from "@pineta/schema"
import { failed } from "../basics.ts"
import { requestOutside } from "../outside.ts"
import type { Refresh } from "./refresh.ts"
import { type OfferState, placedOf } from "./state.ts"

/** A commit message request's size: the skill, recent messages, the thread, the diff. */
const DESCRIBE_BUDGET = 24_000

/**
 * Gathered by a pinned read, which writes nothing (S87): the offer, its diff
 * and your recent messages. Asked outside the owner (a model request takes
 * seconds), and written as an owner command, only while the offer is still
 * the one asked about (`describeWanted`, and the same commit). One request
 * per lane at a time (`describing`), so two settles of one lane never meet.
 * `force` asks again for an offer already described. A failure is logged.
 */
export function describe(
  state: OfferState,
  refresh: Pick<Refresh, "record">,
  lane: LaneName,
  force: boolean,
): Promise<void> {
  const { owner, describing } = state
  const { docs } = state.basics
  const fail = failed(state.basics, "describing its offer", lane)
  if (describing.has(lane)) return Promise.resolve()
  describing.add(lane)
  return owner.track(
    owner
      .read(async ops => {
        // gather
        const now = await state.offerNow(ops, lane)
        if (now === null || now.name === undefined) return null
        const { offer, name } = now
        if (!describeWanted(offer, name, force)) return null
        const [revision] = offer.revisions
        if (revision === undefined) return null
        const diff = (
          await ops
            .jj(["diff", "-r", revision.commit, "--git"])
            .catch(() => null)
        )?.stdout
        const recent = await titlesOf(ops.jj, "ancestors(@-, 20)").catch(
          () => [],
        )
        return { commit: revision.commit, diff: diff ?? "", recent }
      })
      .then(gathered => {
        if (gathered === null) return
        const doc = docs.docOfLane(lane)
        const tip = doc === null ? null : readLaneTip(doc, lane)
        return requestOutside({
          // The owner keeps the request in `idle`; its settle is a command.
          keeper: { run: step => step(), track: work => owner.track(work) },
          failed: fail,
          request: async () => {
            const messages = transcriptLines(
              doc === null ? [] : projectTranscript(readTreeIndex(doc), tip),
            )
            const skill = await state
              .agent()
              .skill("pineta:skill:commit-message")
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
          settle: text =>
            owner.command(async ops => {
              // The offer followed its lane, or you edited it, while the
              // model wrote: the message describes what it held then.
              const now = await state.offerNow(ops, lane)
              if (now === null || now.name === undefined) return
              const { offer, name } = now
              const place = placedOf(now.place)
              if (place === null || !describeWanted(offer, name, force)) return
              const [revision] = offer.revisions
              if (revision === undefined || revision.commit !== gathered.commit)
                return
              await ops.execute(
                planDescribe(
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
              const after = await state.offerNow(ops, lane)
              const at = after === null ? null : placedOf(after.place)
              if (after !== null && after.name !== undefined && at !== null)
                await refresh.record(ops, lane, after.name, at, after.offer)
            }),
        })
      })
      .catch(fail)
      .finally(() => describing.delete(lane)),
  )
}
