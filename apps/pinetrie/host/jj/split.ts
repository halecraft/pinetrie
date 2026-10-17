// host/jj/split — proposed changes split into a stack by a run on its lane: the
// run's prompt, and what its end does.

import { type CommitId, errorText, type ThreadId } from "@pinetrie/core"
import type { RepoOwner } from "@pinetrie/jj"
import {
  laneJj,
  laneStackName,
  readCommits,
  readLaneBookmark,
  stackBookmark,
} from "@pinetrie/jj"
import type { PiSetup } from "@pinetrie/pi"
import { readThreadName } from "@pinetrie/reads"
import { decodeStack, planStack } from "@pinetrie/rules"
import { readEntryMessage } from "@pinetrie/schema"
import type { LeaseBasics } from "../basics.ts"
import type { ProjectParts, Splits } from "../work/adapter.ts"
import type { LaneRegistry } from "../work/registry.ts"
import type { Fetches } from "./fetch.ts"
import type { ProposedChanges } from "./proposed/index.ts"

/**
 * A split's run ended, in order: its stack fetched into your repo, its top read
 * there, and the proposed changes replaced by it if `stackEnded` accepts it.
 * Then, whether or not any of those threw, the lane moved back to its own tip,
 * which it goes on from rather than the stack's: a lane left on the stack
 * refuses every catch-up. Returns why the stack was refused, or null.
 */
export async function finishSplit(
  ports: {
    readonly fetchLane: Fetches["fetchLane"]
    readonly stackTop: (lane: ThreadId) => Promise<CommitId | null>
    readonly stackEnded: ProposedChanges["stackEnded"]
    readonly backToTip: (lane: ThreadId) => Promise<void>
  },
  lane: ThreadId,
  stack: { readonly start: readonly CommitId[]; readonly tip: CommitId },
): Promise<string | null> {
  try {
    await ports.fetchLane(lane, [stack.tip, ...stack.start], true)
    const top = await ports.stackTop(lane)
    return await ports.stackEnded(lane, { ...stack, top })
  } finally {
    await ports.backToTip(lane)
  }
}

export function createSplits(deps: {
  readonly basics: LeaseBasics
  /** The owner of your repo. */
  readonly owner: RepoOwner
  readonly registry: LaneRegistry
  readonly proposed: ProposedChanges
  readonly piSetup: Pick<PiSetup, "skill">
  readonly beforeRun: ProjectParts["beforeRun"]
  readonly fetchLane: Fetches["fetchLane"]
}): Splits {
  const { basics, owner, registry, proposed } = deps
  const { session, log } = basics
  return {
    async prepareSplit(lane, by, intent) {
      if (!registry.isOwn(lane))
        return { refused: "the lane has no copy of its own" }
      const span = await proposed.stackSpan(lane)
      if (span === null)
        return { refused: "the lane has no proposed changes to split" }
      const skill = await deps.piSetup.skill(
        "pinetrie:skill:proposed-changes-stack",
      )
      // Last: nothing between the lane's start and its run can fail.
      deps.beforeRun(lane)
      return planStack({
        skill,
        bookmark: stackBookmark(lane),
        details: { lane, start: span.start, tip: span.tip, by },
        intent,
        timestamp: basics.now(),
      })
    },

    async splitEnded(lane, prompt) {
      await using held = basics.leases.lane(lane)
      const doc = held === null ? null : await held.ready
      const stored =
        doc === null
          ? { present: false as const }
          : readEntryMessage(doc, prompt)
      const details = stored.present ? decodeStack(stored.message) : undefined
      if (!registry.isOwn(lane) || details === undefined) return null
      try {
        const refused = await finishSplit(
          {
            fetchLane: deps.fetchLane,
            stackTop: l =>
              owner.read(
                async ({ jj }) =>
                  (await readCommits(jj, `present(${laneStackName(l)})`))[0] ??
                  null,
              ),
            stackEnded: (l, stack) => proposed.stackEnded(l, stack),
            backToTip: async l => {
              await registry.withHistory(l, async (_h, handle) => {
                const jj = laneJj(handle.runners.lane)
                const tip = await readLaneBookmark(jj, l)
                if (tip !== null) await jj(["new", tip])
              })
            },
          },
          lane,
          { start: details.start, tip: details.tip },
        )
        if (refused !== null)
          log(
            `[host] ${readThreadName(session, lane)}: stack refused: ${refused}`,
          )
        return refused
      } catch (error) {
        return errorText(error)
      }
    },
  }
}
