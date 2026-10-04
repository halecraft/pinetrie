// host/work/split — an offer split into a stack by a run on its lane
// (ADR-0038): the run's prompt, and what its end does.

import type { CommitId, EntryId, LaneName, WriterId } from "@pineta/core"
import {
  bookmarkOf,
  commitsOf,
  laneStackName,
  stackBookmark,
} from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import { readThreadName } from "@pineta/reads"
import type { RepoOwner } from "@pineta/repo"
import { decodeStack, planStack, type StackMessage } from "@pineta/rules"
import { readEntryMessage } from "@pineta/schema"
import { type Basics, messageOf } from "../basics.ts"
import type { Offers } from "../offers/index.ts"
import type { Containers } from "./containers.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"

/**
 * A split's run ended, in order: its stack fetched into your repo, its top
 * read there, the offer replaced by it if `stackEnded` accepts it, and the
 * lane moved back to its own tip, which it goes on from rather than the
 * stack's. Returns why the stack was refused, or null.
 */
export async function finishSplit(
  ports: {
    readonly fetchLane: Fetches["fetchLane"]
    readonly stackTop: (lane: LaneName) => Promise<CommitId | null>
    readonly stackEnded: Offers["stackEnded"]
    readonly backToTip: (lane: LaneName) => Promise<void>
  },
  lane: LaneName,
  stack: { readonly start: readonly CommitId[]; readonly tip: CommitId },
): Promise<string | null> {
  await ports.fetchLane(lane, [stack.tip, ...stack.start], true)
  const top = await ports.stackTop(lane)
  const refused = await ports.stackEnded(lane, { ...stack, top })
  await ports.backToTip(lane)
  return refused
}

export interface Splits {
  /** The prompt of a split's run: the stack's span and the skill. */
  prepareSplit(
    lane: LaneName,
    by: WriterId,
  ): Promise<StackMessage | { readonly refused: string }>
  /** A split's run ended: its stack, checked, becomes the offer, or why not. */
  splitEnded(lane: LaneName, prompt: EntryId): Promise<string | null>
}

export function createSplits(deps: {
  readonly basics: Basics
  /** The owner of your repo when lanes have their own copies, else null. */
  readonly owner: RepoOwner | null
  readonly registry: LaneRegistry
  readonly offers: Offers | null
  readonly agent: () => Agent
  readonly beforeRun: Containers["beforeRun"]
  readonly fetchLane: Fetches["fetchLane"]
}): Splits {
  const { basics, owner, registry, offers } = deps
  const { session, docs, log } = basics
  return {
    async prepareSplit(lane, by) {
      if (!registry.isOwn(lane) || owner === null || offers === null)
        return { refused: "the lane has no copy of its own" }
      const span = await offers.stackSpan(lane)
      if (span === null) return { refused: "the lane has nothing to offer" }
      const skill = await deps.agent().skill("pineta:skill:offer-stack")
      // Last: nothing between the lane's start and its run can fail.
      deps.beforeRun(lane)
      return planStack({
        skill,
        bookmark: stackBookmark(lane),
        details: { lane, start: span.start, tip: span.tip, by },
        timestamp: basics.now(),
      })
    },

    async splitEnded(lane, prompt) {
      const doc = await docs.laneDoc(lane)
      const stored =
        doc === null
          ? { present: false as const }
          : readEntryMessage(doc, prompt)
      const details = stored.present ? decodeStack(stored.message) : undefined
      if (
        !registry.isOwn(lane) ||
        owner === null ||
        details === undefined ||
        offers === null
      )
        return null
      try {
        const refused = await finishSplit(
          {
            fetchLane: deps.fetchLane,
            stackTop: l =>
              owner.read(
                async ({ jj }) =>
                  (await commitsOf(jj, `present(${laneStackName(l)})`))[0] ??
                  null,
              ),
            stackEnded: (l, stack) => offers.stackEnded(l, stack),
            backToTip: async l => {
              const jj = registry.laneJjOf(l)
              await registry.handleOf(l).queue.enqueue(async () => {
                const tip = await bookmarkOf(jj, l)
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
        return messageOf(error)
      }
    },
  }
}
