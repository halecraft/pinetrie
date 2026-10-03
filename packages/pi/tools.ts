// pi/tools — the tools the harness registers, and which of them a lane's
// runs may call.

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core"
import type { BlobStore, LaneName } from "@pineta/core"
import type { BannerAnswer, BannerAsk } from "@pineta/marginalia"
import { BANNER_TOOL, bannerTool } from "./banner.ts"
import { readImageProcessor } from "./images.ts"
import { GUIDANCE_TOOL, guidanceTool, type LaneHooks } from "./lanes.ts"

/**
 * Every tool the harness registers, and the names of pi-agent-core's file
 * tools among them. Each lane uses the file tools in its own directory
 * (`toolContextOf`, in `lanes.ts`). `read` fits an image and stores it
 * before pi writes the result, so the session keeps a reference (ADR-0051).
 */
export function assembleTools(input: {
  readonly hooks: LaneHooks
  readonly blobs: Pick<BlobStore, "put"> | undefined
  /** Where `set_banner` sends its asks; undefined while banners are off. */
  readonly bannerAsks:
    | ((lane: LaneName, ask: BannerAsk) => Promise<BannerAnswer>)
    | undefined
}): { readonly registered: readonly unknown[]; readonly files: string[] } {
  const files = [
    createReadTool(
      input.blobs === undefined
        ? {}
        : { imageProcessor: readImageProcessor(input.blobs) },
    ),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
  ]
  return {
    registered: [
      ...files,
      guidanceTool((lane, q) => input.hooks.askedForGuidance(lane, q)),
      bannerTool(input.bannerAsks),
    ],
    files: files.map(t => t.name),
  }
}

/**
 * What a lane's runs may call: the file tools, `set_banner` when banners
 * are on, and `ask_for_guidance` during a landing. pi stores the list in a
 * lane's configuration once it is set, and fails a run whose list names a
 * tool not registered, so `assembleTools` registers every tool whatever the
 * setting, and `withGuidance` sets this whole list: a lane stored before
 * banners were turned on or off gets the current one at its next run's end.
 */
export function activeToolNames(input: {
  readonly files: readonly string[]
  readonly banners: boolean
  readonly guidance: boolean
}): string[] {
  return [
    ...input.files,
    ...(input.banners ? [BANNER_TOOL] : []),
    ...(input.guidance ? [GUIDANCE_TOOL] : []),
  ]
}

/** Whether `next` names other tools than `active`, in any order. */
export function toolsChanged(
  active: readonly string[],
  next: readonly string[],
): boolean {
  const now = new Set(active)
  return now.size !== new Set(next).size || next.some(t => !now.has(t))
}
