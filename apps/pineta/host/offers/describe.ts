// host/offers/describe — an agent's commit message for a single offer
// (ADR-0038): a one-shot model request outside the thread.

import { type LaneName, projectTranscript } from "@pineta/core"
import { executeOnHost, lines, planDescribe } from "@pineta/lanes"
import {
  describeRequest,
  transcriptLines,
  withTrailers,
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
 * Gathered and asked outside the queue (a model request takes seconds),
 * written inside it, and only while the offer is still the one asked about
 * and unedited (`requestOutside`). `force` asks again for an offer already
 * described. A failure is logged.
 */
export function describe(
  state: OfferState,
  refresh: Pick<Refresh, "record">,
  lane: LaneName,
  force: boolean,
): Promise<void> {
  const { ops, root } = state
  const { doc } = state.basics
  const before = state.offerOf(lane)
  if (before === undefined || before.taken !== null || before.edited)
    return Promise.resolve()
  if (before.size !== 1 || (before.described && !force))
    return Promise.resolve()
  const [change] = before.host.changes
  const [wrote] = before.host.wrote
  if (change === undefined || wrote === undefined) return Promise.resolve()
  const tip = readLaneTip(doc, lane)
  return requestOutside({
    serial: state.serial,
    failed: failed(state.basics, "describing its offer", lane),
    request: async () => {
      const diff = (await ops(["diff", "-r", wrote, "--git"]).catch(() => null))
        ?.stdout
      const recent = lines(
        (
          await ops([
            "log",
            "--no-graph",
            "-r",
            "ancestors(@-, 20)",
            "-T",
            'description.first_line() ++ "\\n"',
          ])
        ).stdout,
      )
      const messages = transcriptLines(
        projectTranscript(readTreeIndex(doc), tip),
      )
      const skill = await state.agent().skill("pineta:skill:commit-message")
      return state.agent().complete(
        describeRequest({
          skill: skill?.content ?? "Write a commit message for this change.",
          diff: diff ?? "",
          messages,
          recent,
          budget: DESCRIBE_BUDGET,
        }),
      )
    },
    settle: async text => {
      const now = state.offerOf(lane)
      if (now === undefined || now.taken !== null || now.edited) return
      const name = state.nameOf(lane)
      // The offer followed its lane, or where it starts, while the model
      // wrote: the message describes what it held then.
      if (
        name === undefined ||
        now.host.changes[0] !== change ||
        now.host.tip !== before.host.tip ||
        now.host.start.join() !== before.host.start.join()
      )
        return
      const target = await state.targetNow()
      const facts = await state.factsOf(now, target)
      if (facts.revisions.some(r => !r.sameDescription || !r.sameChange)) return
      await executeOnHost(
        planDescribe(
          root,
          change,
          withTrailers(text, { lane, name, entry: tip ?? "" }),
        ),
      )
      const after = await state.factsOf(now, target)
      await refresh.record(lane, {
        bookmark: now.bookmark,
        tip: now.host.tip,
        start: now.host.start,
        commits: after.commits,
        changes: now.host.changes,
        target,
        stale: now.stale,
        described: true,
        edited: false,
      })
    },
  })
}
