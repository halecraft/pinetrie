// host/banners — each thread's column banner: made when its run ends, or set
// when the person asks through `set_banner`. `planBanner` decides; this
// carries it out.

import {
  type BannerFocus,
  type BlobStore,
  firstPromptOf,
  type LaneName,
  projectTranscript,
  type Sha256,
  type StoredImage,
} from "@pineta/core"
import {
  answerOf,
  BANNER_ATTEMPTS,
  type BannerAnswer,
  type BannerAsk,
  type BannerConfig,
  type BannerPlan,
  type BannerTrigger,
  BRIEF_BUDGET,
  bannerRequest,
  bannerStillWanted,
  planBanner,
  ratioFor,
  threadLines,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import {
  readBanners,
  readNames,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import { readLaneTip } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { Serial } from "./queue.ts"

export interface Banners {
  /** A lane's run ended: make its banner if it has none. */
  ran(lane: LaneName): Promise<void>
  /** `set_banner`'s ask, answered once planned; a new image arrives later. */
  request(lane: LaneName, ask: BannerAsk): Promise<BannerAnswer>
}

type BannerAgent = Pick<
  Agent,
  "canDrawBanners" | "drawBanner" | "describe" | "skill" | "setWorkRecord"
>

export function createBanners(deps: {
  readonly basics: Pick<Basics, "doc" | "log" | "now">
  readonly serial: Serial
  readonly blobs: Pick<BlobStore, "put" | "ref">
  readonly config: BannerConfig
  /** Read lazily: the agent is made with `request` as its tool's port. */
  readonly agent: () => BannerAgent
}): Banners {
  const { basics, serial, blobs, config } = deps
  const { doc, log } = basics
  // Lanes whose banner is being made: a run's end does not start a second.
  const generating = new Set<LaneName>()

  /** Gather, plan, and write what ends when written; start a generation. */
  const decide = (lane: LaneName, trigger: BannerTrigger) =>
    serial.run(async (): Promise<BannerPlan> => {
      const plan = planBanner({
        trigger,
        banner: readBanners(doc).get(lane),
        generating: generating.has(lane),
        stored: sha => blobs.ref(sha) !== undefined,
      })
      if (plan.kind === "write") await write(lane, plan.sha, plan.focus)
      if (plan.kind === "generate") {
        generating.add(lane)
        void serial.track(
          generate(lane, trigger, plan).finally(() => generating.delete(lane)),
        )
      }
      return plan
    })

  const write = (lane: LaneName, sha: Sha256, focus: BannerFocus) =>
    deps.agent().setWorkRecord({
      kind: "banner",
      record: { lane, sha, focus, at: basics.now() },
    })

  /**
   * The brief, then the image, outside the serial (each takes seconds); then,
   * inside it, the write, only if still wanted. Never rejects: a failure is
   * logged, and a run's end tries again.
   */
  async function generate(
    lane: LaneName,
    trigger: BannerTrigger,
    plan: BannerPlan & { kind: "generate" },
  ): Promise<void> {
    const agent = deps.agent()
    const name = readNames(doc).get(lane) ?? null
    const failed = (why: string) =>
      log(`[host] no banner for ${name ?? lane}: ${why}`)
    try {
      if (!(await agent.canDrawBanners())) return
      const index = readTreeIndex(doc)
      const tip = readLaneTip(doc, lane)
      const lines = threadLines(
        projectTranscript(index, tip),
        firstPromptOf(index, readRevisions(doc), lane, tip),
      )
      const skill = await agent.skill("pineta:skill:column-banner")
      const brief = await agent.describe(
        bannerRequest({
          skill:
            skill?.content ??
            "Write an image prompt for a very wide, dark banner about this thread. No text in the image.",
          name,
          direction: plan.direction,
          ...lines,
          budget: BRIEF_BUDGET,
        }),
      )
      if (brief === null) return failed("the brief was not written")
      const image = await drawWithRetries(agent, brief, failed)
      if (image === null) return
      await serial.run(async () => {
        if (!bannerStillWanted(trigger, readBanners(doc).get(lane))) return
        await write(lane, blobs.put(image).sha256, plan.focus)
      })
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error))
    }
  }

  /** Up to `BANNER_ATTEMPTS` draws, each at `ratioFor` its attempt; each failure logged. */
  async function drawWithRetries(
    agent: BannerAgent,
    brief: string,
    failed: (why: string) => void,
  ): Promise<StoredImage | null> {
    for (let n = 0; n < BANNER_ATTEMPTS; n += 1) {
      const drawn = await agent.drawBanner(brief, ratioFor(n, config))
      if (drawn.kind === "drawn") return drawn.image
      failed(`attempt ${n + 1}: ${drawn.reason}`)
    }
    return null
  }

  return {
    ran: async lane => {
      await decide(lane, { kind: "ran" })
    },
    request: async (lane, ask) =>
      answerOf(await decide(lane, { kind: "asked", ask })),
  }
}
