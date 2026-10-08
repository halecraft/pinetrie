// banner — the image in a thread's column header: whether a thread gets one,
// what the image model is asked, the setting that turns it on, and its
// record (`pinetrie.banner`). The host carries the plan out.

import {
  type BannerRecord,
  isSha256,
  type Sha256,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { Type } from "typebox"
import { type ModelRef, modelRef, recordOf } from "./config.ts"
import { decodeAt, threadKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const BannerRecordSchema = Type.Object({
  sha: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  at: Type.Number(),
})

/** Each thread's column banner, the image's hash, at its lane. */
export const BANNER: RecordSpec<BannerRecord, ThreadId, "session"> = {
  namespace: "pinetrie.banner",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(BannerRecordSchema, contents, threadKey(key), (r, lane) =>
      isSha256(r.sha) ? { lane, sha: r.sha, at: r.at } : undefined,
    ),
}

// ── the setting ───────────────────────────────────────────────────────────

/** Banners' image model. */
export type BannerConfig = ModelRef

/**
 * Recraft V4.1 Flash: 0.7¢ an image and about 1.5 seconds, as OpenRouter
 * lists it. pi-ai 0.87.1 does not list it; `imageModelFor` describes it.
 */
export const DEFAULT_BANNER: BannerConfig = {
  provider: "openrouter",
  model: "recraft/recraft-v4.1-flash",
}

/**
 * The user config's `banner`: null unless `enabled` is `true`. `model` is
 * `provider/id` (`modelRef`). Total: a malformed model takes the default.
 */
export function decodeBannerConfig(json: unknown): BannerConfig | null {
  const banner = recordOf(recordOf(json)?.banner)
  if (banner?.enabled !== true) return null
  return modelRef(banner.model) ?? DEFAULT_BANNER
}

// ── the decision ──────────────────────────────────────────────────────────

/** A generation is tried this many times before the host gives up. */
export const BANNER_ATTEMPTS = 3

/** What `set_banner` asked for, as the agent called it. */
export interface BannerAsk {
  /** A pasted image, as its `/blob/` hash. */
  readonly image: Sha256 | null
  /** The person's words for a new banner. */
  readonly direction: string | null
}

/**
 * Pure. Whether a thread, just named or at its run's end, is due a banner:
 * only when it has none and none is being made. So a new thread gets one as
 * it is named, enabling banners never makes one for every old thread, and a
 * failed one is tried again at the thread's next run's end.
 */
export const bannerDue = (
  banner: BannerRecord | undefined,
  generating: boolean,
): boolean => banner === undefined && !generating

type AskPlan =
  | { readonly kind: "generate"; readonly direction: string | null }
  /** Write the record: a pasted image. */
  | { readonly kind: "write"; readonly sha: Sha256 }
  | { readonly kind: "refused"; readonly reason: "not_stored" }

/**
 * Pure. A pasted image is used when stored and refused otherwise; anything
 * else makes a new one, even while one is being made.
 */
export const planAsk = (
  ask: BannerAsk,
  stored: (sha: Sha256) => boolean,
): AskPlan =>
  ask.image === null
    ? { kind: "generate", direction: ask.direction }
    : stored(ask.image)
      ? { kind: "write", sha: ask.image }
      : { kind: "refused", reason: "not_stored" }

/** What `set_banner` tells the agent: the host's answer to its ask. */
export type BannerAnswer =
  /** A new banner is being made; it arrives in seconds, or is logged as failed. */
  | { readonly kind: "requested" }
  /** The record is written: a pasted image. */
  | { readonly kind: "set" }
  | {
      readonly kind: "refused"
      readonly reason: "not_stored" | "no_thread" | "off"
    }

/** A plan as the tool's answer, given once it is planned. */
export const answerOf = (plan: AskPlan): BannerAnswer =>
  plan.kind === "generate"
    ? { kind: "requested" }
    : plan.kind === "write"
      ? { kind: "set" }
      : { kind: "refused", reason: plan.reason }

/**
 * Whether a banner is still wanted once it arrives: one a thread was due
 * gives way to any banner written meanwhile, which the person chose; one
 * the person asked for is always written.
 */
export const bannerStillWanted = (
  asked: boolean,
  now: BannerRecord | undefined,
): boolean => asked || now === undefined

// ── the prompt ────────────────────────────────────────────────────────────

/**
 * The image model's prompt: the template (the `column-banner` skill's body)
 * with `{adjective}` and `{noun}` filled from the thread's name, and the
 * person's direction after it. The thread's messages are never
 * sent: the banner is the name's.
 */
export function bannerPrompt(input: {
  readonly template: string
  readonly name: ThreadName
  readonly direction: string | null
}): string {
  const at = input.name.indexOf("-")
  const adjective = at < 0 ? "" : input.name.slice(0, at)
  const noun = input.name.slice(at + 1)
  const filled = input.template
    .trim()
    .replaceAll("{adjective}", adjective)
    .replaceAll("{noun}", noun)
  const direction = input.direction?.trim() ?? ""
  return direction === ""
    ? filled
    : `${filled}\n\nAbove all, the person asks for: ${direction}`
}
