// host/describe — an agent's description of a lane's proposed changes, whatever
// kind of project: a one-shot model request outside the thread, by the
// commit-message skill, over the proposed changes' diff, the thread's messages
// and your recent work. One request per lane at a time, so two settles of one
// lane never meet. Each adapter gathers its proposed changes and decides, as it
// settles, whether the proposed changes are still the one asked about.

import { projectTranscript, type ThreadId } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { PiSetup } from "@pinetrie/pi"
import { readTreeIndex } from "@pinetrie/reads"
import { describeRequest, transcriptLines } from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { type Basics, failed } from "./basics.ts"

/** A description request's size: the skill, recent messages, the thread, the diff. */
const DESCRIBE_BUDGET = 24_000

/** What an adapter gathered to describe: its own facts, and the diff and recent work the request reads. */
export interface DescribeGathered<G> {
  readonly gathered: G
  readonly diff: string
  /** Your recent work's titles, which the description's style follows. */
  readonly recent: readonly string[]
}

export type Describe = <G>(input: {
  readonly lane: ThreadId
  /** Where the request is tracked, and its settle run. */
  readonly keeper: Pick<Keeper, "run" | "track">
  /** Null for nothing to describe. */
  readonly gather: () => Promise<DescribeGathered<G> | null>
  /** The text written, if the proposed changes are still the one `gathered` read; the thread's tip then. */
  readonly settle: (
    gathered: G,
    text: string,
    tip: string | null,
  ) => Promise<void>
}) => Promise<void>

/** The describer of a host: one request per lane at a time; a failure is logged. */
export function createDescriber(deps: {
  readonly basics: Pick<Basics, "docs" | "session" | "log">
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
}): Describe {
  const describing = new Set<ThreadId>()
  return input => {
    const { lane } = input
    const fail = failed(deps.basics, "describing its proposed changes", lane)
    if (describing.has(lane)) return Promise.resolve()
    describing.add(lane)
    return input.keeper.track(
      input
        .gather()
        .then(async asked => {
          if (asked === null) return
          const doc = deps.basics.docs.docOfLane(lane)
          const tip = doc === null ? null : readLaneTip(doc, lane)
          // Asked outside the keeper, which tracks it, then settled in a step
          // of the keeper's. Not a late write of the documents' (`later.ts`):
          // each adapter's settle writes only while its proposed changes are
          // the one asked about, and an archive withdraws its threads' proposed
          // changes.
          const messages = transcriptLines(
            doc === null ? [] : projectTranscript(readTreeIndex(doc), tip),
          )
          const skill = await deps.piSetup.skill(
            "pinetrie:skill:commit-message",
          )
          const { text } = await deps.piSetup.complete(
            describeRequest({
              skill:
                skill?.content ?? "Write a commit message for this change.",
              diff: asked.diff,
              messages,
              recent: asked.recent,
              budget: DESCRIBE_BUDGET,
            }),
          )
          if (text === null) return
          await input.keeper.run(() => input.settle(asked.gathered, text, tip))
        })
        .catch(fail)
        .finally(() => describing.delete(lane)),
    )
  }
}
