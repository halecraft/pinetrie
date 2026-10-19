// host/banners — each thread's banner: drawn as the thread is named, and again
// at a run's end if that failed, while the config's icons are `drawn`;
// or set when the person asks through `set_banner`. `bannerDue` and `planAsk`
// decide; this carries them out, each write a late one (`later.ts`), so none
// lands in a thread archived or gone meanwhile.

import {
  type BlobStore,
  errorText,
  type Sha256,
  type StoredImage,
  type ThreadId,
} from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import { readBanners, readNames } from "@pinetrie/reads"
import {
  BANNER,
  BANNER_ATTEMPTS,
  type BannerAnswer,
  type BannerAsk,
  bannerAnswer,
  bannerDue,
  bannerPrompt,
  bannerStillWanted,
  planAsk,
  setRecord,
} from "@pinetrie/rules"
import type { Basics } from "./basics.ts"
import type { Later } from "./later.ts"

export interface Banners {
  /** A lane was named, or its run ended: make its banner if it has none. */
  due(lane: ThreadId): Promise<void>
  /** `set_banner`'s ask, answered once planned; a new image arrives later. */
  request(lane: ThreadId, ask: BannerAsk): Promise<BannerAnswer>
}

export function createBanners(deps: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly later: Later
  readonly blobs: Pick<BlobStore, "put" | "ref">
  /** The image model, and the banner's skill. */
  readonly piSetup: Pick<PiSetup, "canDrawBanners" | "drawBanner" | "skill">
  /** Whether icons are drawn: the settled `icons.source` is `drawn`. */
  readonly draws: boolean
}): Banners {
  const { basics, later, blobs, draws } = deps
  const { session: doc, log } = basics
  // Lanes whose banner is being made: a run's end does not start a second.
  const generating = new Set<ThreadId>()

  const banner = (lane: ThreadId, sha: Sha256) => ({
    records: [setRecord(BANNER, { lane, sha, at: basics.now() })],
  })
  const scope = (lane: ThreadId) => ({ kind: "thread", thread: lane }) as const

  const failedFor = (lane: ThreadId) => (why: string) =>
    log(`[host] no banner for ${readNames(doc).get(lane) ?? lane}: ${why}`)

  /**
   * A new image, outside the keeper (it takes seconds); then, inside it, the
   * write, only if still wanted. A failure is logged, and the thread's next
   * run's end tries again.
   */
  const start = (lane: ThreadId, direction: string | null, asked: boolean) =>
    void later.outside({
      scope: scope(lane),
      what: "a banner",
      held: { set: generating, key: lane },
      request: () => generate(lane, direction),
      plan: image =>
        bannerStillWanted(asked, readBanners(doc).get(lane))
          ? banner(lane, blobs.put(image).sha256)
          : null,
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
      later.step(scope(lane), "a banner", () => {
        if (bannerDue(readBanners(doc).get(lane), generating.has(lane), draws))
          start(lane, null, false)
        return null
      }),
    async request(lane, ask) {
      // A thread its gate refuses gets no banner, as one with no thread.
      let answer: BannerAnswer = { kind: "refused", reason: "no-thread" }
      await later.step(scope(lane), "a banner", () => {
        const plan = planAsk(ask, sha => blobs.ref(sha) !== undefined, draws)
        answer = bannerAnswer(plan)
        if (plan.kind === "generate") start(lane, plan.direction, true)
        return plan.kind === "write" ? banner(lane, plan.sha) : null
      })
      return answer
    },
  }
}
