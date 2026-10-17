// banner — a thread's icon: the setting that chooses where icons come from
// and its published record, whether a thread is due a drawn one, what the
// image model is asked, and the record of a drawn or pasted one.

import {
  type BannerRecord,
  ICON_SOURCES,
  type IconSource,
  type IconsRecord,
  isSha256,
  type Sha256,
  type ThreadId,
  type ThreadName,
  threadNameParts,
} from "@pinetrie/core"
import { Type } from "typebox"
import type { ModelRef } from "./config.ts"
import { decodeRecord, fixedKey, threadKey } from "./decode.ts"
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
    decodeRecord(BannerRecordSchema, contents, threadKey(key), (r, lane) =>
      isSha256(r.sha) ? { lane, sha: r.sha, at: r.at } : undefined,
    ),
}

// ── the setting ───────────────────────────────────────────────────────────

/** Where icons come from, and for `drawn`, the image model that draws them. */
export type IconConfig =
  | { readonly source: Exclude<IconSource, "drawn"> }
  | { readonly source: "drawn"; readonly model: ModelRef }

/**
 * Recraft V4.1 Flash: 0.7¢ an image and about 1.5 seconds, as OpenRouter
 * lists it. pi-ai 0.87.1 does not list it; `imageModelFor` describes it.
 */
export const DEFAULT_ICON_MODEL: ModelRef = {
  provider: "openrouter",
  model: "recraft/recraft-v4.1-flash",
}

/** Where icons come from: a drawn one's model is the configured one, else the default. */
export const iconConfig = (
  source: IconSource,
  model: ModelRef | null,
): IconConfig =>
  source === "drawn"
    ? { source, model: model ?? DEFAULT_ICON_MODEL }
    : { source }

/** The one `pinetrie.icons` value's key. */
export const ICONS_KEY = "icons"

const IconsRecordSchema = Type.Object({
  source: Type.Union(ICON_SOURCES.map(s => Type.Literal(s))),
})

/** The host's icon source, at its one key, for the page to read. */
export const ICONS: RecordSpec<IconsRecord, typeof ICONS_KEY, "session"> = {
  namespace: "pinetrie.icons",
  home: "session",
  keyOf: () => ICONS_KEY,
  encode: r => ({ source: r.source }),
  decode: (contents, key) =>
    decodeRecord(IconsRecordSchema, contents, fixedKey(ICONS_KEY, key), r => r),
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
 * Whether a thread, just named or at its run's end, is due a drawn banner:
 * only while the host draws, and when it has none and none is being made.
 * So a new thread gets one as it is named, choosing `drawn` never makes one
 * for every old thread, and a failed one is tried again at the thread's
 * next run's end.
 */
export const bannerDue = (
  banner: BannerRecord | undefined,
  generating: boolean,
  draws: boolean,
): boolean => draws && banner === undefined && !generating

type AskPlan =
  | { readonly kind: "generate"; readonly direction: string | null }
  /** Write the record: a pasted image. */
  | { readonly kind: "write"; readonly sha: Sha256 }
  | { readonly kind: "refused"; readonly reason: "not_stored" | "off" }

/**
 * A pasted image is used when stored and refused otherwise, whatever the
 * source; anything else makes a new one while the host draws, even while
 * one is being made, and is refused otherwise.
 */
export const planAsk = (
  ask: BannerAsk,
  stored: (sha: Sha256) => boolean,
  draws: boolean,
): AskPlan =>
  ask.image !== null
    ? stored(ask.image)
      ? { kind: "write", sha: ask.image }
      : { kind: "refused", reason: "not_stored" }
    : draws
      ? { kind: "generate", direction: ask.direction }
      : { kind: "refused", reason: "off" }

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
export const bannerAnswer = (plan: AskPlan): BannerAnswer =>
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
  const parts = threadNameParts(input.name)
  const filled = input.template
    .trim()
    .replaceAll("{adjective}", parts?.adjective ?? "")
    .replaceAll("{noun}", parts?.noun ?? "")
  const direction = input.direction?.trim() ?? ""
  return direction === ""
    ? filled
    : `${filled}\n\nAbove all, the person asks for: ${direction}`
}
