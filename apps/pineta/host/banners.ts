// host/banners — each thread's column banner: made as the thread is named,
// again at a run's end if that failed, or set when the person asks through
// `set_banner`. `bannerDue` and `planAsk` decide; this carries them out.

import type { BlobStore, LaneName, Sha256, StoredImage } from "@pineta/core"
import type { Keeper } from "@pineta/keeper"
import {
  answerOf,
  BANNER,
  BANNER_ATTEMPTS,
  type BannerAnswer,
  type BannerAsk,
  bannerDue,
  bannerPrompt,
  bannerStillWanted,
  planAsk,
  setRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readBanners, readNames } from "@pineta/reads"
import type { Basics } from "./basics.ts"
import { requestOutside } from "./outside.ts"

export interface Banners {
  /** A lane was named, or its run ended: make its banner if it has none. */
  due(lane: LaneName): Promise<void>
  /** `set_banner`'s ask, answered once planned; a new image arrives later. */
  request(lane: LaneName, ask: BannerAsk): Promise<BannerAnswer>
}

type BannerAgent = Pick<
  Agent,
  "canDrawBanners" | "drawBanner" | "skill" | "writeValues"
>

export function createBanners(deps: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly keeper: Keeper
  readonly blobs: Pick<BlobStore, "put" | "ref">
  /** Read lazily: the agent is made with `request` as its tool's port. */
  readonly agent: () => BannerAgent
}): Banners {
  const { basics, keeper, blobs } = deps
  const { session: doc, log } = basics
  // Lanes whose banner is being made: a run's end does not start a second.
  const generating = new Set<LaneName>()

  const write = (lane: LaneName, sha: Sha256) =>
    deps
      .agent()
      .writeValues([setRecord(BANNER, { lane, sha, at: basics.now() })])

  const failedFor = (lane: LaneName) => (why: string) =>
    log(`[host] no banner for ${readNames(doc).get(lane) ?? lane}: ${why}`)

  /**
   * A new image, outside the keeper (it takes seconds); then, inside it, the
   * write, only if still wanted (`requestOutside`). A failure is logged, and
   * the thread's next run's end tries again.
   */
  const start = (lane: LaneName, direction: string | null, asked: boolean) =>
    void requestOutside({
      keeper,
      held: { set: generating, key: lane },
      request: () => generate(lane, direction),
      settle: async image => {
        if (!bannerStillWanted(asked, readBanners(doc).get(lane))) return
        await write(lane, blobs.put(image).sha256)
      },
      failed: error =>
        failedFor(lane)(error instanceof Error ? error.message : String(error)),
    })

  /** The image to write, or null: no name yet, no key, no skill, or every draw failed. */
  async function generate(
    lane: LaneName,
    direction: string | null,
  ): Promise<StoredImage | null> {
    const agent = deps.agent()
    const name = readNames(doc).get(lane)
    const failed = failedFor(lane)
    if (name === undefined) {
      failed("the thread has no name yet")
      return null
    }
    if (!(await agent.canDrawBanners())) return null
    const skill = await agent.skill("pineta:skill:column-banner")
    if (skill === null) {
      failed("no column-banner skill")
      return null
    }
    const prompt = bannerPrompt({ template: skill.content, name, direction })
    return drawWithRetries(agent, prompt, failed)
  }

  /** Up to `BANNER_ATTEMPTS` draws; each failure logged. */
  async function drawWithRetries(
    agent: BannerAgent,
    prompt: string,
    failed: (why: string) => void,
  ): Promise<StoredImage | null> {
    for (let n = 0; n < BANNER_ATTEMPTS; n += 1) {
      const drawn = await agent.drawBanner(prompt)
      if (drawn.kind === "drawn") return drawn.image
      failed(`attempt ${n + 1}: ${drawn.reason}`)
    }
    return null
  }

  return {
    due: lane =>
      keeper.run(async () => {
        const due = bannerDue(readBanners(doc).get(lane), generating.has(lane))
        if (due) start(lane, null, false)
      }),
    request: (lane, ask) =>
      keeper.run(async () => {
        const plan = planAsk(ask, sha => blobs.ref(sha) !== undefined)
        if (plan.kind === "write") await write(lane, plan.sha)
        if (plan.kind === "generate") start(lane, plan.direction, true)
        return answerOf(plan)
      }),
  }
}
