// pi/tools — the tools the harness registers, and which of them a lane's
// runs may call.

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core"
import {
  ASK_TOOL,
  BANNER_TOOL,
  BASH_TOOL,
  type BlobStore,
  CATCH_UP_TOOL,
  CONFLICT_TOOL,
  EDIT_TOOL,
  FIND_TOOL,
  GREP_TOOL,
  LEAVE_TOOL,
  READ_TOOL,
  SPLIT_TOOL,
  type ThreadId,
  TOOL_IDS,
  type ToolId,
  WRITE_TOOL,
} from "@pinetrie/core"
import type { BannerAnswer, BannerAsk } from "@pinetrie/rules"
import { bannerTool } from "./banner.ts"
import { readImageProcessor } from "./images.ts"
import { conflictTool, type LaneHooks } from "./lanes.ts"
import { findTool, grepTool } from "./search.ts"
import { askTool, catchUpTool, leaveTool, splitTool } from "./thread-tools.ts"

export interface ToolsInput {
  readonly hooks: LaneHooks
  readonly blobs: Pick<BlobStore, "put"> | undefined
  /** Where `set_banner` sends its asks; undefined while banners are off. */
  readonly bannerAsks:
    | ((lane: ThreadId, ask: BannerAsk) => Promise<BannerAnswer>)
    | undefined
}

/**
 * Each tool, made, by its id (ADR-0114): a tool with no factory fails to
 * compile, and `tools.test.ts` checks each is named its id, which catches a
 * pi upgrade renaming one of its own. pi-agent-core makes `read`, `write`,
 * `edit` and `bash`; pine·trie makes the rest.
 */
export const TOOLS: Readonly<
  Record<ToolId, (input: ToolsInput) => { readonly name: string }>
> = {
  // `read` fits an image and stores it before pi writes the result, so the
  // session keeps a reference (ADR-0051).
  [READ_TOOL]: input =>
    createReadTool(
      input.blobs === undefined
        ? {}
        : { imageProcessor: readImageProcessor(input.blobs) },
    ),
  [WRITE_TOOL]: () => createWriteTool(),
  [EDIT_TOOL]: () => createEditTool(),
  [BASH_TOOL]: () => createBashTool(),
  [GREP_TOOL]: () => grepTool(),
  [FIND_TOOL]: () => findTool(),
  [CONFLICT_TOOL]: input =>
    conflictTool((lane, q) => input.hooks.askedAboutConflict(lane, q)),
  [CATCH_UP_TOOL]: input =>
    catchUpTool((lane, from) => input.hooks.catchUp(lane, from)),
  [SPLIT_TOOL]: input => splitTool(lane => input.hooks.askSplit(lane)),
  [BANNER_TOOL]: input => bannerTool(input.bannerAsks),
  [ASK_TOOL]: input =>
    askTool((lane, to, text) => input.hooks.ask(lane, to, text)),
  [LEAVE_TOOL]: input =>
    leaveTool((lane, thread) => input.hooks.leave(lane, thread)),
}

/**
 * The file tools: pi-agent-core's `read`, `write`, `edit` and `bash`, and our
 * `grep` and `find` (ADR-0064). Each lane uses them in its own directory
 * (`toolContextOf`, in `lanes.ts`). They are also pi's `selectedTools`, and
 * naming `grep` or `find` there drops pi's rule to search with bash.
 */
const FILE_TOOLS: readonly ToolId[] = [
  READ_TOOL,
  WRITE_TOOL,
  EDIT_TOOL,
  BASH_TOOL,
  GREP_TOOL,
  FIND_TOOL,
]

/**
 * Every tool the harness registers, in `TOOL_IDS`' order, and the names of
 * the file tools among them. Besides the file tools, the tools the host
 * answers: `ask_about_conflict`, `catch_up` and `split_offer` (ADR-0080),
 * `set_banner`, and `ask` and `leave` (ADR-0128).
 */
export function assembleTools(input: ToolsInput): {
  readonly registered: readonly unknown[]
  readonly files: string[]
} {
  return {
    registered: TOOL_IDS.map(id => TOOLS[id](input)),
    files: [...FILE_TOOLS],
  }
}

/**
 * What a lane's runs may call: every tool, in `TOOL_IDS`' order, but
 * `set_banner` only when banners are on. One list for every run, a
 * resolution's included, whatever kind of lane runs it: a tool that does not
 * apply answers why. A list that changed between runs would change every
 * request's prefix, and Anthropic then drops the lane's earlier thinking
 * (S85). pi stores the list in a lane's configuration, and fails a run whose
 * list names a tool not registered, so `assembleTools` registers every tool
 * whatever the setting, and a lane stored with another list is given this
 * one when it is first held (`threadLanes`).
 */
export function activeToolNames(input: {
  readonly banners: boolean
}): string[] {
  return TOOL_IDS.filter(id => input.banners || id !== BANNER_TOOL)
}

/** Whether `next` names other tools than `active`, in any order. */
export function toolsChanged(
  active: readonly string[],
  next: readonly string[],
): boolean {
  const now = new Set(active)
  return now.size !== new Set(next).size || next.some(t => !now.has(t))
}
