// pi/banner — `set_banner`, the tool that sets a thread's column banner when
// the person asks, and the arguments it takes. The host decides and writes
// (`planBanner`); this only reads the call.

import {
  BANNER_FOCUSES,
  blobOfUrl,
  isSha256,
  type LaneName,
  type Sha256,
} from "@pineta/core"
import {
  type BannerAnswer,
  type BannerAsk,
  parseFocus,
} from "@pineta/marginalia"
import { Type } from "typebox"
import { laneOf } from "./lanes.ts"

export const BANNER_TOOL = "set_banner"

type Context = Parameters<typeof laneOf>[0]

/** A pasted image as the agent passed it: `/blob/<sha256>`, or the hash alone. */
const imageOf = (s: string): Sha256 | null =>
  isSha256(s) ? s : blobOfUrl(s.trim())

/**
 * The call's arguments as an ask, or why not: an image argument that names
 * no pasted image is refused, not ignored, or the agent would report a
 * banner the person did not get. Pure.
 */
export function parseBannerArgs(args: {
  readonly image?: string
  readonly direction?: string
  readonly focus?: string
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
  return { image, direction, focus: parseFocus(args.focus) }
}

/** The host's answer, as the agent reads it. */
export function bannerAnswerText(answer: BannerAnswer): string {
  switch (answer.kind) {
    case "requested":
      return "A new banner is being made. It appears in this thread's column header in about ten seconds."
    case "set":
      return "The banner is set."
    case "unchanged":
      return "The banner is already so."
    case "refused":
      return answer.reason === "not_stored"
        ? "That image is not stored: ask the person to paste it again."
        : answer.reason === "off"
          ? "Banners are off: the person turns them on in ~/.config/pineta/config.json."
          : "This call has no thread to set a banner on."
  }
}

/**
 * The tool. `request` is the host's, and answers once the ask is planned,
 * not once an image is made; undefined when banners are off. It is
 * registered either way, since a lane's stored tool list may still name it
 * (see `activeTools` in `agent.ts`).
 */
export function bannerTool(
  request:
    | ((lane: LaneName, ask: BannerAsk) => Promise<BannerAnswer>)
    | undefined,
) {
  return {
    name: BANNER_TOOL,
    label: "set banner",
    description:
      "Set the image behind this thread's column header. Use it only when the person asks. With `image`, use an image the person pasted; with `direction`, or nothing, make a new one; with `focus` alone, move the crop of the banner there is.",
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
      focus: Type.Optional(
        Type.Union(
          BANNER_FOCUSES.map(f => Type.Literal(f)),
          {
            description:
              "Which band of the image the thin header shows: upper, a quarter of the way down, unless asked",
          },
        ),
      ),
    }),
    async execute(
      _id: string,
      params: { image?: string; direction?: string; focus?: string },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = laneOf(context)
      const ask = parseBannerArgs(params)
      const text =
        "refused" in ask
          ? ask.refused
          : request === undefined
            ? bannerAnswerText({ kind: "refused", reason: "off" })
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
