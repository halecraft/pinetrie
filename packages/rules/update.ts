// update — a thread's base, or the thread it branched from, merged into it.

import { firstLine } from "@pinetrie/core"
import type { Static } from "typebox"
import { Type } from "typebox"
import { count } from "./counts.ts"
import { List, PointSchema, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import {
  LatestFromSchema,
  latestSourceName,
  latestWords,
} from "./latest-from.ts"
import { REMOVALS_HEADING, type RemovalsText } from "./removals.ts"

const UpdateDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  from: LatestFromSchema,
  /** The state merged: accepted work's, the WIP's copy, or the parent's newest. */
  merged: PointSchema,
  /** The commits that came in, newest first: each one's first line. */
  commits: List(Type.String()),
  files: List(Type.String()),
  by: WriterIdSchema,
})

type UpdateDetails = Static<typeof UpdateDetailsSchema>

export const UPDATE = historyMessage("pinetrie.update", UpdateDetailsSchema)

/** The pi `CustomMessage` an update is stored as. */
export type UpdateMessage = HistoryMessage<"pinetrie.update", UpdateDetails>

/** A stored message -> its update details, or undefined if it is not one. */
export const decodeUpdate = UPDATE.decode

/** The one line a column shows for an update. */
export const updateLine = (d: UpdateDetails): string =>
  `↓ got the latest from ${latestSourceName(d.from)}: ${d.files.length === 0 ? "no file" : count(d.files.length, "file", "files")} changed`

/**
 * What came in to a folder lane, as a catch-up's titles: a folder project's
 * history has no commit messages, so it is named by where it came from.
 */
export const folderLatest = (from: "folder" | "parent"): string =>
  from === "folder"
    ? "accepted work, as it was last read"
    : "the newest work of the thread this one branched from"

/**
 * The update message, for the model: what came in, which of this thread's
 * files changed, or that none did, and then what getting the latest removed
 * from the disk, if anything. The commits are empty when all that came in
 * was accepted thread commits of work the copy holds, which a catch-up joins
 * and does not list (`withoutAcceptedThreadCommits`, `@pinetrie/lanes`).
 */
export function encodeUpdate(
  details: UpdateDetails,
  timestamp: number,
  removals: RemovalsText,
): UpdateMessage {
  const commits =
    details.commits.length === 0
      ? "- only work this copy already holds, as accepted thread commits\n"
      : details.commits.map(c => `- ${firstLine(c, 200)}\n`).join("")
  const what = latestWords(details.from)
  const files = details.files.map(f => `- ${f}\n`).join("")
  const merged =
    files === ""
      ? `${what} was merged into this thread's own copy. It changed no file in this copy, so what you read before still holds.\n\nWhat came in:\n${commits}`
      : `${what} was merged into this thread's own copy, so these files changed under you. Read them again before relying on what you saw earlier.\n\n` +
        `What came in:\n${commits}\nFiles that changed:\n${files}`
  return UPDATE.encode(
    details,
    removals === "" ? merged : `${merged}\n${REMOVALS_HEADING}:\n${removals}`,
    timestamp,
  )
}
