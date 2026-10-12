// host/banners — each thread's banner: drawn as the thread is named, and again
// at a run's end if that failed, while the user config's icons are `drawn`;
// or set when the person asks through `set_banner`. `bannerDue` and `planAsk`
// decide; this carries them out.

import {
  type BlobStore,
  errorText,
  type Sha256,
  type StoredImage,
  type ThreadId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { PiSetup } from "@pinetrie/pi"
import { readBanners, readNames } from "@pinetrie/reads"
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
} from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import { requestOutside } from "./outside.ts"
import type { Records } from "./records.ts"

export interface Banners {
  /** A lane was named, or its run ended: make its banner if it has none. */
  due(lane: ThreadId): Promise<void>
  /** `set_banner`'s ask, answered once planned; a new image arrives later. */
  request(lane: ThreadId, ask: BannerAsk): Promise<BannerAnswer>
}

export function createBanners(deps: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly keeper: Keeper
  readonly blobs: Pick<BlobStore, "put" | "ref">
  readonly records: Pick<Records, "writeValues">
  /** The image model, and the banner's skill. */
  readonly piSetup: Pick<PiSetup, "canDrawBanners" | "drawBanner" | "skill">
  /** Whether icons are drawn: the user config's `icons.source` is `drawn`. */
  readonly draws: boolean
}): Banners {
  const { basics, keeper, blobs, draws } = deps
  const { session: doc, log } = basics
  // Lanes whose banner is being made: a run's end does not start a second.
  const generating = new Set<ThreadId>()

  const write = (lane: ThreadId, sha: Sha256) =>
    deps.records.writeValues([
      setRecord(BANNER, { lane, sha, at: basics.now() }),
    ])

  const failedFor = (lane: ThreadId) => (why: string) =>
    log(`[host] no banner for ${readNames(doc).get(lane) ?? lane}: ${why}`)

  /**
   * A new image, outside the keeper (it takes seconds); then, inside it, the
   * write, only if still wanted (`requestOutside`). A failure is logged, and
   * the thread's next run's end tries again.
   */
  const start = (lane: ThreadId, direction: string | null, asked: boolean) =>
    void requestOutside({
      keeper,
      held: { set: generating, key: lane },
      request: () => generate(lane, direction),
      settle: async image => {
        if (!bannerStillWanted(asked, readBanners(doc).get(lane))) return
        await write(lane, blobs.put(image).sha256)
      },
      failed: error => failedFor(lane)(errorText(error)),
    })

  /** The image to write, or null: no name yet, no key, no skill, or every draw failed. */
  async function generate(
    lane: ThreadId,
    direction: string | null,
  ): Promise<StoredImage | null> {
    const { piSetup } = deps
    const name = readNames(doc).get(lane)
    const failed = failedFor(lane)
    if (name === undefined) {
      failed("the thread has no name yet")
      return null
    }
    if (!(await piSetup.canDrawBanners())) return null
    const skill = await piSetup.skill("pinetrie:skill:column-banner")
    if (skill === null) {
      failed("no column-banner skill")
      return null
    }
    const prompt = bannerPrompt({ template: skill.content, name, direction })
    return drawWithRetries(prompt, failed)
  }

  /** Up to `BANNER_ATTEMPTS` draws; each failure logged. */
  async function drawWithRetries(
    prompt: string,
    failed: (why: string) => void,
  ): Promise<StoredImage | null> {
    for (let n = 0; n < BANNER_ATTEMPTS; n += 1) {
      const drawn = await deps.piSetup.drawBanner(prompt)
      if (drawn.kind === "drawn") return drawn.image
      failed(`attempt ${n + 1}: ${drawn.reason}`)
    }
    return null
  }

  return {
    due: lane =>
      keeper.run(async () => {
        const due = bannerDue(
          readBanners(doc).get(lane),
          generating.has(lane),
          draws,
        )
        if (due) start(lane, null, false)
      }),
    request: (lane, ask) =>
      keeper.run(async () => {
        const plan = planAsk(ask, sha => blobs.ref(sha) !== undefined, draws)
        if (plan.kind === "write") await write(lane, plan.sha)
        if (plan.kind === "generate") start(lane, plan.direction, true)
        return answerOf(plan)
      }),
  }
}
