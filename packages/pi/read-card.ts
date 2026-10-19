// pi/read-card — `read_card`: a card of the thread's canvas read by its id,
// an image as the image (the model sees its fitted copy), a media column or a
// note column as text. The host decides what is read (`LaneHooks.readCard`).
// The image part's bytes are the blob store's, so the session keeps it as a
// reference, as `read`'s images are kept.

import type { ThreadId } from "@pinetrie/core"
import { READ_CARD_TOOL } from "@pinetrie/threads"
import { Type } from "typebox"
import { threadOfContext } from "./thread-context.ts"

type Context = Parameters<typeof threadOfContext>[0]

/** The host's answer to a `read_card` call: its words, and an image to show. */
export interface CardReadAnswer {
  readonly text: string
  readonly image: { readonly data: string; readonly mimeType: string } | null
}

export function readCardTool(
  read: (
    lane: ThreadId,
    card: string,
    version: number | null,
  ) => Promise<CardReadAnswer>,
) {
  return {
    name: READ_CARD_TOOL,
    label: "read a card",
    description:
      "Read a card of this thread's canvas by the id the canvas list gives: an image (you see it; `version` reads an older one, from 1), a media column (its images), or a note column (its notes).",
    parameters: Type.Object({
      card: Type.String({
        description: "The card's id, as the canvas list gives it",
      }),
      version: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: "An image's version, from 1; omitted, the newest",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: { card: string; version?: number },
      _onUpdate: unknown,
      _toolContext: unknown,
      _invocation: unknown,
      context: Context,
    ) {
      const lane = threadOfContext(context)
      if (lane === undefined)
        return {
          content: [
            { type: "text" as const, text: "This call reached no thread." },
          ],
          details: undefined,
        }
      const answer = await read(lane, params.card, params.version ?? null)
      return {
        content: [
          { type: "text" as const, text: answer.text },
          ...(answer.image === null
            ? []
            : [{ type: "image" as const, ...answer.image }]),
        ],
        details: undefined,
      }
    },
  }
}
