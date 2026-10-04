// pi/tools — the tools the harness registers, and which of them a lane's
// runs may call.

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core"
import type { BlobStore, LaneName } from "@pineta/core"
import type { BannerAnswer, BannerAsk } from "@pineta/rules"
import { BANNER_TOOL, bannerTool } from "./banner.ts"
import { readImageProcessor } from "./images.ts"
import { GUIDANCE_TOOL, guidanceTool, type LaneHooks } from "./lanes.ts"
import { findTool, grepTool } from "./search.ts"

/**
 * Every tool the harness registers, and the names of the file tools among
 * them: pi-agent-core's `read`, `write`, `edit` and `bash`, and our `grep` and
 * `find` (ADR-0064). Each lane uses the file tools in its own directory
 * (`toolContextOf`, in `lanes.ts`). They are also pi's `selectedTools`, and
 * naming `grep` or `find` there drops pi's rule to search with bash. `read`
 * fits an image and stores it before pi writes the result, so the session
 * keeps a reference (ADR-0051).
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
    grepTool(),
    findTool(),
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
 * What a lane's runs may call: the file tools, `ask_for_guidance`, and
 * `set_banner` when banners are on. One list for every run, a landing's
 * included: a list that changed between runs would change every request's
 * prefix, and Anthropic then drops the lane's earlier thinking (S85). pi
 * stores the list in a lane's configuration, and fails a run whose list
 * names a tool not registered, so `assembleTools` registers every tool
 * whatever the setting, and a lane stored with another list is given this
 * one when it is first held (`threadLanes`).
 */
export function activeToolNames(input: {
  readonly files: readonly string[]
  readonly banners: boolean
}): string[] {
  return [
    ...input.files,
    GUIDANCE_TOOL,
    ...(input.banners ? [BANNER_TOOL] : []),
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
