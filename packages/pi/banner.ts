// pi/banner — `set_banner`, the tool that sets a thread's column banner when
// the person asks, and the arguments it takes. The host decides and writes
// (`planAsk`); this only reads the call. Also drawing a banner's image
// (`banners`), and what its request adds for OpenRouter
// (`bannerImageConfig`).

import {
  BANNER_TOOL,
  blobOfUrl,
  errorText,
  isSha256,
  type Sha256,
  type StoredImage,
  type ThreadId,
} from "@pinetrie/core"
import type { BannerAnswer, BannerAsk, ModelRef } from "@pinetrie/rules"
import { Type } from "typebox"
import type { ImagesSetup } from "./config.ts"
import { prepareImage } from "./images.ts"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/** A pasted image as the agent passed it: `/blob/<sha256>`, or the hash alone. */
const imageOf = (s: string): Sha256 | null =>
  isSha256(s) ? s : blobOfUrl(s.trim())

/**
 * The call's arguments as an ask, or why not: an image argument that names
 * no pasted image is refused, not ignored, or the agent would report a
 * banner the person did not get.
 */
export function parseBannerArgs(args: {
  readonly image?: string
  readonly direction?: string
}): BannerAsk | { readonly refused: string } {
  const image =
    args.image === undefined || args.image.trim() === ""
      ? null
      : imageOf(args.image)
  if (image === null && args.image !== undefined && args.image.trim() !== "")
    return {
      refused: `"${args.image}" is not a pasted image: pass its /blob/<sha256> path from the message.`,
    }
  const direction = args.direction?.trim() || null
  return { image, direction }
}

/**
 * OpenRouter's `image_config` for a banner, which pi-ai does not send. 1:1
 * suits every model, since OpenRouter clamps a ratio to what the model has.
 * A Recraft model is also given the black background that the prompt asks
 * for and the client blends away. The field is Recraft's alone, so another
 * model is not sent it.
 */
export function bannerImageConfig(modelId: string): {
  readonly aspect_ratio: "1:1"
  readonly background_rgb_color?: readonly [number, number, number]
} {
  return modelId.startsWith("recraft/")
    ? { aspect_ratio: "1:1", background_rgb_color: [0, 0, 0] }
    : { aspect_ratio: "1:1" }
}

/** The host's answer, as the agent reads it. */
export function bannerAnswerText(answer: BannerAnswer): string {
  switch (answer.kind) {
    case "requested":
      return "A new banner is being made. It appears in this thread's column header in about ten seconds."
    case "set":
      return "The banner is set."
    case "refused":
      return answer.reason === "not_stored"
        ? "That image is not stored: ask the person to paste it again."
        : answer.reason === "off"
          ? 'New banners are drawn only when "icons": { "source": "drawn" } is in ~/.config/pinetrie/config.json: paste an image to set one now.'
          : "This call has no thread to set a banner on."
  }
}

/**
 * The tool. `request` is the host's, and answers once the ask is planned,
 * not once an image is made: a drawing the icon source does not allow is
 * the host's refusal.
 */
export function bannerTool(
  request: (lane: ThreadId, ask: BannerAsk) => Promise<BannerAnswer>,
) {
  return {
    name: BANNER_TOOL,
    label: "set banner",
    description:
      "Set the image in this thread's column header. Use it only when the person asks. With `image`, use an image the person pasted; with `direction`, or nothing, make a new one from the thread's name.",
    parameters: Type.Object({
      image: Type.Optional(
        Type.String({
          description:
            "A pasted image's path as the message shows it: /blob/<sha256>",
        }),
      ),
      direction: Type.Optional(
        Type.String({
          description: "The person's words for a new banner",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: { image?: string; direction?: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      const ask = parseBannerArgs(params)
      const text =
        "refused" in ask
          ? ask.refused
          : lane === undefined
            ? bannerAnswerText({ kind: "refused", reason: "no_thread" })
            : bannerAnswerText(await request(lane, ask))
      return {
        content: [{ type: "text" as const, text }],
        details: undefined,
      }
    },
  }
}

/**
 * A banner's image, fitted as an upload is (`prepareImage`), or why there is
 * none.
 */
export type Drawn =
  | { readonly kind: "drawn"; readonly image: StoredImage }
  | { readonly kind: "failed"; readonly reason: string }

/** A model's image, as base64, fitted as an upload is, or why it is not one. */
export async function drawnOf(data: string): Promise<Drawn> {
  const prepared = await prepareImage(
    new Uint8Array(Buffer.from(data, "base64")),
  )
  return prepared.ok
    ? { kind: "drawn", image: prepared.image }
    : { kind: "failed", reason: prepared.reason }
}

/** How long one image request may take: one takes about 9 s. */
const DRAW_TIMEOUT_MS = 120_000

export interface Banners {
  /**
   * Whether a banner can be drawn: an image model was given, pi knows it,
   * and there is a key for its provider. Asked first, so a host with
   * no key spends nothing.
   */
  canDrawBanners(): Promise<boolean>
  /**
   * One square banner image from `prompt`, fitted as an upload is. Never
   * rejects: a failure, no image model or bytes that are not an image
   * included, is `failed` and why.
   */
  drawBanner(prompt: string): Promise<Drawn>
}

/** Banners drawn with `config`'s image model; with no config, none is drawn. */
export function banners(
  images: ImagesSetup,
  config: ModelRef | undefined,
): Banners {
  const imageModel =
    config === undefined
      ? undefined
      : images.model(config.provider, config.model)
  return {
    async canDrawBanners() {
      if (imageModel === undefined) return false
      return (await images.apiKey(imageModel.provider)) !== undefined
    },

    async drawBanner(prompt) {
      const failed = (reason: string): Drawn => ({ kind: "failed", reason })
      if (imageModel === undefined) return failed("no banner model")
      try {
        const apiKey = await images.apiKey(imageModel.provider)
        if (apiKey === undefined)
          return failed(`no key for ${imageModel.provider}`)
        const reply = await images.models.generateImages(
          imageModel,
          { input: [{ type: "text", text: prompt }] },
          {
            apiKey,
            timeoutMs: DRAW_TIMEOUT_MS,
            onPayload: payload => ({
              ...(payload as object),
              image_config: bannerImageConfig(imageModel.id),
            }),
          },
        )
        const image = reply.output.find(o => o.type === "image")
        if (reply.stopReason !== "stop")
          return failed(reply.errorMessage ?? reply.stopReason)
        if (image?.type !== "image") return failed("the reply held no image")
        return await drawnOf(image.data)
      } catch (error) {
        return failed(errorText(error))
      }
    },
  }
}
