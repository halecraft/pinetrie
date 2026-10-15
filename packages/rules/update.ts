// update — a thread's base, or the thread it branched from, merged into it.

import { firstLine } from "@pinetrie/core"
import type { Static } from "typebox"
import { Type } from "typebox"
import {
  CatchUpFromSchema,
  catchUpName,
  incomingWords,
} from "./catch-up-from.ts"
import { List, PointSchema, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"

const UpdateDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  from: CatchUpFromSchema,
  /** The state merged: accepted work's, the WIP's copy, or the parent's newest. */
  merged: PointSchema,
  /** The commits that came in, newest first: each one's first line. */
  commits: List(Type.String()),
  files: List(Type.String()),
  by: WriterIdSchema,
})

export type UpdateDetails = Static<typeof UpdateDetailsSchema>

export const UPDATE = historyMessage("pinetrie.update", UpdateDetailsSchema)

/** The pi `CustomMessage` an update is stored as. */
export type UpdateMessage = HistoryMessage<"pinetrie.update", UpdateDetails>

/** A stored message -> its update details, or undefined if it is not one. */
export const decodeUpdate = UPDATE.decode

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** The one line a column shows for an update. */
export const updateLine = (d: UpdateDetails): string =>
  `↓ caught up with ${catchUpName(d.from)}: ${d.files.length === 0 ? "no file" : plural(d.files.length, "file", "files")} changed`

/**
 * The update message, for the model: what came in, and which of this
 * thread's files changed, or that none did. The commits are empty when all
 * that came in was accepted offers of work the copy holds, which a catch-up
 * joins and does not list (`withoutAcceptedOfferCommits`, `@pinetrie/lanes`).
 */
export function encodeUpdate(
  details: UpdateDetails,
  timestamp: number,
): UpdateMessage {
  const commits =
    details.commits.length === 0
      ? "- only work this copy already holds, as accepted offers\n"
      : details.commits.map(c => `- ${firstLine(c, 200)}\n`).join("")
  const what = incomingWords(details.from)
  const files = details.files.map(f => `- ${f}\n`).join("")
  return UPDATE.encode(
    details,
    files === ""
      ? `${what} was merged into this thread's own copy. It changed no file in this copy, so what you read before still holds.\n\nWhat came in:\n${commits}`
      : `${what} was merged into this thread's own copy, so these files changed under you. Read them again before relying on what you saw earlier.\n\n` +
          `What came in:\n${commits}\nFiles that changed:\n${files}`,
    timestamp,
  )
}
