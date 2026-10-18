// pi/tools — the tools the harness registers, and which of them a lane's
// runs may call.

import path from "node:path"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core"
import type { Context } from "@earendil-works/pi-agent-core/harness/context"
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
  PROJECT_CONFIG_FILE,
  PROPOSE_TOOL,
  READ_TOOL,
  RESOLVE_TOOL,
  SAVE_BLOB_TOOL,
  SPLIT_TOOL,
  type ThreadId,
  TOOL_IDS,
  type ToolId,
  WRITE_TOOL,
} from "@pinetrie/core"
import type { BannerAnswer, BannerAsk } from "@pinetrie/rules"
import { bannerTool } from "./banner.ts"
import { readImageProcessor } from "./images.ts"
import { requireIntent, TAKES_INTENT } from "./intent.ts"
import { conflictTool, type LaneHooks } from "./lanes.ts"
import { saveBlobTool } from "./save-blob.ts"
import { findTool, grepTool } from "./search.ts"
import { threadOfContext } from "./thread-context.ts"
import {
  askTool,
  catchUpTool,
  leaveTool,
  proposeTool,
  resolveTool,
  splitTool,
} from "./thread-tools.ts"

interface ToolsInput {
  readonly hooks: LaneHooks
  readonly blobs: Pick<BlobStore, "put"> | undefined
  /** Where `set_banner` sends its asks: the host answers each. */
  readonly bannerAsks: (lane: ThreadId, ask: BannerAsk) => Promise<BannerAnswer>
}

/**
 * Each tool, made, by its id: a tool with no factory fails to
 * compile, and `tools.test.ts` checks each is named its id, which catches a
 * pi upgrade renaming one of its own. pi-agent-core makes `read`, `write`,
 * `edit` and `bash`; pine·trie makes the rest.
 */
export const TOOLS: Readonly<
  Record<ToolId, (input: ToolsInput) => { readonly name: string }>
> = {
  // `read` fits an image and stores it before pi writes the result, so the
  // session keeps a reference.
  [READ_TOOL]: input =>
    createReadTool(
      input.blobs === undefined
        ? {}
        : { imageProcessor: readImageProcessor(input.blobs) },
    ),
  [WRITE_TOOL]: input =>
    noteConfigWrites(createWriteTool(), lane =>
      input.hooks.configWritten(lane),
    ),
  [EDIT_TOOL]: input =>
    noteConfigWrites(createEditTool(), lane => input.hooks.configWritten(lane)),
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
  [RESOLVE_TOOL]: input =>
    resolveTool((lane, path, choose) =>
      input.hooks.resolveConflict(lane, path, choose),
    ),
  [SAVE_BLOB_TOOL]: input =>
    saveBlobTool((lane, blob) => input.hooks.readBlob(lane, blob)),
  [PROPOSE_TOOL]: () => proposeTool(),
}

type Executes = {
  readonly execute: (...args: never[]) => Promise<{
    readonly content: readonly unknown[]
  }>
}

/**
 * `tool` whose result, after it wrote the lane's `pinetrie.json`, carries
 * the host's note on it: what applies at once and what waits for
 * acceptance. Wrapped, not replaced: its name, description and parameters
 * stay pi's, so the tool list and the prompt do not change; `requireIntent`
 * adds the intent outside it (`assembleTools`).
 */
function noteConfigWrites<T extends Executes>(
  tool: T,
  note: (lane: ThreadId) => Promise<string | null>,
): T {
  const execute = tool.execute as (...args: unknown[]) => Promise<{
    readonly content: readonly unknown[]
  }>
  return {
    ...tool,
    async execute(...args: unknown[]) {
      const result = await execute(...args)
      const params = args[1] as { readonly path?: unknown } | undefined
      const dir = (args[3] as { readonly dir?: unknown } | undefined)?.dir
      const lane = threadOfContext(args[5] as Context)
      if (
        lane === undefined ||
        typeof params?.path !== "string" ||
        typeof dir !== "string" ||
        path.posix.resolve(dir, params.path) !==
          path.posix.join(dir, PROJECT_CONFIG_FILE)
      )
        return result
      const said = await note(lane)
      return said === null
        ? result
        : {
            ...result,
            content: [...result.content, { type: "text", text: said }],
          }
    },
  }
}

/**
 * The file tools: pi-agent-core's `read`, `write`, `edit` and `bash`, and our
 * `grep` and `find`. Each lane uses them in its own directory
 * (`laneToolContext`, in `lanes.ts`). They are also pi's `selectedTools`, and
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
 * Every tool the harness registers, in `TOOL_IDS`' order, each that takes
 * an intent (`TAKES_INTENT`) requiring one, and the names of the file tools
 * among them.
 */
export function assembleTools(input: ToolsInput): {
  readonly registered: readonly unknown[]
  readonly files: string[]
} {
  const made = (id: ToolId) => {
    const tool = TOOLS[id](input)
    return TAKES_INTENT[id] ? requireIntent(tool as never) : tool
  }
  return {
    registered: TOOL_IDS.map(made),
    files: [...FILE_TOOLS],
  }
}

/** Whether `next` names other tools than `active`, in any order. */
export function toolsChanged(
  active: readonly string[],
  next: readonly string[],
): boolean {
  const now = new Set(active)
  return now.size !== new Set(next).size || next.some(t => !now.has(t))
}
