// banner — the image behind a thread's column header: whether a thread gets
// one, what the image model is asked, and the setting that turns it on.
// The record is `work.ts`'s (`pineta.banner`); the host carries the plan out.

import {
  BANNER_FOCUSES,
  type BannerFocus,
  type BannerRecord,
  DEFAULT_BANNER_FOCUS,
  type EntryId,
  type Sha256,
  type ThreadName,
  type TranscriptMessage,
} from "@pineta/core"
import {
  fitNewest,
  LEFT_OUT_NOTE,
  leftOut,
  transcriptLines,
} from "./request.ts"

// ── the setting ───────────────────────────────────────────────────────────

/** Banners' image model and the shape asked of it. */
export interface BannerConfig {
  readonly provider: string
  readonly model: string
  /** OpenRouter's `image_config.aspect_ratio`, as `W:H`. */
  readonly aspectRatio: string
}

/**
 * Nano Banana 2's preview: the one model probed that makes 8:1, close to the
 * header's shape (S60).
 */
export const DEFAULT_BANNER: BannerConfig = {
  provider: "openrouter",
  model: "google/gemini-3.1-flash-image-preview",
  aspectRatio: "8:1",
}

/** Every image model probed accepts it (S60): what a retry asks for. */
export const FALLBACK_RATIO = "21:9"

const RATIO = /^[1-9][0-9]*:[1-9][0-9]*$/

const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

/**
 * The user config's `banner`: null unless `enabled` is `true`. `model` is
 * `provider/id`, split at its first `/`, as the id may hold more. Total: a
 * malformed model or ratio takes the default.
 */
export function decodeBannerConfig(json: unknown): BannerConfig | null {
  const banner = recordOf(recordOf(json)?.banner)
  if (banner?.enabled !== true) return null
  const at = typeof banner.model === "string" ? banner.model.indexOf("/") : -1
  const named =
    typeof banner.model === "string" && at > 0 && at < banner.model.length - 1
      ? {
          provider: banner.model.slice(0, at),
          model: banner.model.slice(at + 1),
        }
      : { provider: DEFAULT_BANNER.provider, model: DEFAULT_BANNER.model }
  const aspectRatio =
    typeof banner.aspectRatio === "string" && RATIO.test(banner.aspectRatio)
      ? banner.aspectRatio
      : DEFAULT_BANNER.aspectRatio
  return { ...named, aspectRatio }
}

// ── the decision ──────────────────────────────────────────────────────────

/** A generation is tried this many times before the host gives up. */
export const BANNER_ATTEMPTS = 3

/**
 * The ratio asked for on attempt `n` (from 0): the configured one first, then
 * one every model has, so a model refusing the configured ratio still gets a
 * banner without the refusal's text being read.
 */
export const ratioFor = (n: number, config: BannerConfig): string =>
  n === 0 ? config.aspectRatio : FALLBACK_RATIO

/** What `set_banner` asked for, as the agent called it. */
export interface BannerAsk {
  /** A pasted image, as its `/blob/` hash. */
  readonly image: Sha256 | null
  /** The person's words for a new banner. */
  readonly direction: string | null
  readonly focus: BannerFocus | null
}

/** What starts a banner: a lane's run ending, or `set_banner`. */
export type BannerTrigger =
  | { readonly kind: "ran" }
  | { readonly kind: "asked"; readonly ask: BannerAsk }

export type BannerPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "generate"
      readonly direction: string | null
      readonly focus: BannerFocus
    }
  /** Write the record: a pasted image, or a new crop of the banner there is. */
  | {
      readonly kind: "write"
      readonly sha: Sha256
      readonly focus: BannerFocus
    }
  | { readonly kind: "refused"; readonly reason: "not_stored" }

/**
 * Pure. A run's end makes a banner only for a thread with none and none
 * being made, so enabling banners never makes one for every old thread, and
 * a failed one is tried again at the thread's next run's end. Asked, the
 * person's image, crop or words win:
 *
 * - an image is used when stored, and refused otherwise;
 * - a crop alone moves the banner there is, or makes one cropped so;
 * - anything else makes a new one.
 */
export function planBanner(facts: {
  readonly trigger: BannerTrigger
  readonly banner: BannerRecord | undefined
  readonly generating: boolean
  readonly stored: (sha: Sha256) => boolean
}): BannerPlan {
  const { trigger, banner } = facts
  if (trigger.kind === "ran")
    return banner !== undefined || facts.generating
      ? { kind: "none" }
      : { kind: "generate", direction: null, focus: DEFAULT_BANNER_FOCUS }
  const { image, direction, focus } = trigger.ask
  if (image !== null)
    return facts.stored(image)
      ? { kind: "write", sha: image, focus: focus ?? DEFAULT_BANNER_FOCUS }
      : { kind: "refused", reason: "not_stored" }
  if (direction === null && focus !== null && banner !== undefined)
    return banner.focus === focus
      ? { kind: "none" }
      : { kind: "write", sha: banner.sha, focus }
  return { kind: "generate", direction, focus: focus ?? DEFAULT_BANNER_FOCUS }
}

/** What `set_banner` tells the agent: the host's answer to its ask. */
export type BannerAnswer =
  /** A new banner is being made; it arrives in seconds, or is logged as failed. */
  | { readonly kind: "requested" }
  /** The record is written: a pasted image, or a new crop. */
  | { readonly kind: "set" }
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "refused"
      readonly reason: "not_stored" | "no_thread" | "off"
    }

/** A plan as the tool's answer, for the plans that end when written. */
export const answerOf = (plan: BannerPlan): BannerAnswer => {
  switch (plan.kind) {
    case "none":
      return { kind: "unchanged" }
    case "generate":
      return { kind: "requested" }
    case "write":
      return { kind: "set" }
    case "refused":
      return { kind: "refused", reason: plan.reason }
  }
}

/**
 * Whether a banner made for `trigger` is still wanted once it arrives: one a
 * run's end started gives way to any banner written meanwhile, which the
 * person chose.
 */
export const bannerStillWanted = (
  trigger: BannerTrigger,
  now: BannerRecord | undefined,
): boolean => trigger.kind === "asked" || now === undefined

// ── the request ───────────────────────────────────────────────────────────

const OWN = "What this thread said:\n"
const BEFORE = "\nWhat came before it, for context only:\n"

/** A banner brief's request size, the skill aside: the thread and its parent. */
export const BRIEF_BUDGET = 8_000

/**
 * A thread's path as the brief reads it: its own lines from `first`, its
 * first prompt (`firstPromptOf`), and the lines before. With no first
 * prompt on the path, every line is its own.
 */
export function threadLines(
  messages: readonly TranscriptMessage[],
  first: EntryId | null,
): { readonly own: string[]; readonly before: string[] } {
  const at = first === null ? -1 : messages.findIndex(m => m.id === first)
  return at < 0
    ? { own: transcriptLines(messages), before: [] }
    : {
        own: transcriptLines(messages.slice(at)),
        before: transcriptLines(messages.slice(0, at)),
      }
}

/** A crop the agent passed, or null for none or one not known. */
export const parseFocus = (s: unknown): BannerFocus | null =>
  BANNER_FOCUSES.find(f => f === s) ?? null

/**
 * The brief's request: the skill as the system text, then the thread's name,
 * the person's direction, what the thread said, and what came before it.
 * The thread's own lines take the room first, newest first; the parent's get
 * what is left, so sibling threads, which share it, differ; with no room
 * for one of them, the section is left out. The skill is never cut.
 */
export function bannerRequest(input: {
  readonly skill: string
  /** Null before the host has named the thread. */
  readonly name: ThreadName | null
  readonly direction: string | null
  /** The thread's own lines, from its first prompt on. */
  readonly own: readonly string[]
  /** The lines before it: the thread it branched from, or people before the agent. */
  readonly before: readonly string[]
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const head =
    (input.name === null ? "" : `The thread is called "${input.name}".\n`) +
    (input.direction === null
      ? ""
      : `The person asked for: ${input.direction.trim()}\n`) +
    "\n"
  const room = Math.max(0, input.budget - head.length - OWN.length)
  const own = fitNewest(input.own, Math.max(0, room - LEFT_OUT_NOTE))
  const said = leftOut(own.dropped) + (own.text || "- (no messages)\n")
  const before = fitNewest(
    input.before,
    Math.max(0, room - said.length - BEFORE.length - LEFT_OUT_NOTE),
  )
  const context =
    before.text === ""
      ? ""
      : `${BEFORE}${leftOut(before.dropped)}${before.text}`
  return {
    system: input.skill.trim(),
    user: `${head}${OWN}${said}${context}`,
  }
}
