// pi/put-image — `put_image`: an image from the agent's lane, or one shared
// in the thread, put in a media column of the thread's canvas, or added as a
// version of an image there. A file is fitted and stored here, as `read`'s
// images are (`prepareImage`); the host decides where it goes and writes it
// as the thread's person (`LaneHooks.putImage`).

import path from "node:path"
import {
  type BlobStore,
  blobOfUrl,
  isSha256,
  type Sha256,
  type ThreadId,
} from "@pinetrie/core"
import type { PutImageAsk, ToolAnswer } from "@pinetrie/rules"
import { PUT_IMAGE_TOOL } from "@pinetrie/threads"
import { Type } from "typebox"
import { prepareImage } from "./images.ts"
import type { ToolContext } from "./lanes.ts"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

const text = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  details: undefined,
})

/** A shared image as the agent passed it: `/blob/<sha256>`, or the hash alone. */
const sharedOf = (s: string): Sha256 | null =>
  isSha256(s.trim()) ? (s.trim() as Sha256) : blobOfUrl(s.trim())

const optional = (s: string | undefined): string | null =>
  s === undefined || s.trim() === "" ? null : s.trim()

export function putImageTool(
  blobs: Pick<BlobStore, "put"> | undefined,
  put: (lane: ThreadId, ask: PutImageAsk) => Promise<ToolAnswer>,
) {
  return {
    name: PUT_IMAGE_TOOL,
    label: "put an image",
    description:
      "Put an image in a media column of this thread's canvas, for the person and the team to see and compare: a file in your lane (a screenshot, a drawing) or a /blob/<sha256> shared in the thread. Name the column by its title or id; a column no media column has is made at the canvas's end with that title. With `onto`, an image's id from the canvas list, the image is added as a new version of it instead.",
    parameters: Type.Object({
      image: Type.String({
        description:
          "A path in your lane, relative to your working directory or absolute, or a shared image's /blob/<sha256>",
      }),
      column: Type.Optional(
        Type.String({
          description:
            "The media column's title or id; omitted, a new untitled column",
        }),
      ),
      onto: Type.Optional(
        Type.String({
          description: "An image's id: add this as a new version of it",
        }),
      ),
      title: Type.Optional(
        Type.String({
          description: "The image's title; omitted, its file's name",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: { image: string; column?: string; onto?: string; title?: string },
      _onUpdate: unknown,
      toolContext: ToolContext,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      if (lane === undefined) return text("This call reached no thread.")
      const shared = sharedOf(params.image)
      let sha: Sha256
      let name: string
      if (shared !== null) {
        sha = shared
        name = "image"
      } else {
        if (blobs === undefined)
          return text("Images are not stored here: there is no blob store.")
        const at = path.posix.resolve(toolContext.dir, params.image)
        const read = await toolContext.env.readBinaryFile(at, context)
        if (!read.ok) return text(`Not read: ${read.error.message}`)
        const prepared = await prepareImage(read.value)
        if (!prepared.ok) return text(`${at} is ${prepared.reason}.`)
        sha = blobs.put(prepared.original, prepared.image).sha256
        name = path.posix.basename(at)
      }
      const answer = await put(lane, {
        sha256: sha,
        name,
        title: optional(params.title),
        column: optional(params.column),
        onto: optional(params.onto),
      })
      return text(answer.text)
    },
  }
}
