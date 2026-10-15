// pi/save-blob — `save_blob`: a file shared in the thread, saved into the
// agent's own lane. The host answers which bytes (`LaneHooks.readBlob`); the
// tool writes them through its tool context's environment, so the helper
// records the write as the agent's, as it records `write`'s.

import path from "node:path"
import { SAVE_BLOB_TOOL, type Sha256, type ThreadId } from "@pinetrie/core"
import { Type } from "typebox"
import type { ToolContext } from "./lanes.ts"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/** The host's answer to a `save_blob` call: the blob's bytes, or why not. */
export type BlobAnswer =
  | {
      readonly kind: "blob"
      readonly sha256: Sha256
      readonly bytes: Uint8Array
    }
  | { readonly kind: "refused"; readonly text: string }

const text = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  details: undefined,
})

/** `save_blob`'s answer once written: where, and how many bytes. */
export const savedText = (at: string, bytes: number): string =>
  `Saved ${bytes} bytes to ${at}.`

export function saveBlobTool(
  readBlob: (lane: ThreadId, blob: string) => Promise<BlobAnswer>,
) {
  return {
    name: SAVE_BLOB_TOOL,
    label: "save a shared file",
    description:
      "Save a file shared in this thread (a /blob/<sha256> link in a message) to a path in your lane, to read or use it there. A path in the repo puts the file in your offer; a path .gitignore ignores keeps it to this lane; a shared directory shares it with the person and every thread.",
    parameters: Type.Object({
      blob: Type.String({
        description:
          "The shared file's link as the message shows it: /blob/<sha256>",
      }),
      path: Type.String({
        description:
          "Where to save it, relative to your working directory or absolute",
      }),
    }),
    async execute(
      _id: string,
      params: { blob: string; path: string },
      _onUpdate: unknown,
      toolContext: ToolContext,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      if (lane === undefined) return text("This call reached no thread.")
      const answer = await readBlob(lane, params.blob)
      if (answer.kind === "refused") return text(answer.text)
      const at = path.posix.resolve(toolContext.dir, params.path)
      const wrote = await toolContext.env.writeFile(at, answer.bytes, context)
      return text(
        wrote.ok
          ? savedText(at, answer.bytes.byteLength)
          : `Not saved: ${wrote.error.message}`,
      )
    },
  }
}
