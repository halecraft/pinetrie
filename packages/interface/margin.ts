// interface/margin — an entry's margin as its column draws it: its comments,
// notes that people read and the agent does not. Shut, the margin is the count
// of its comments beside its entry, a signal and no level of detail; open, its comments drawn normal
// under the entry (`DETAIL_ON`). The words are here, `marginCounts`
// (`@pinetrie/rules`) the counts, and `Margin` (`packages/web/margin.tsx`)
// draws it.

import { plural } from "./counts.ts"

/** A message's comment tool: a note in its margin, for people. */
export const COMMENT = {
  label: "comment",
  title:
    "comment on this message: a note beside it, for everyone on the canvas; the agent does not read it",
} as const

/** What a margin is beside: a message, or an image in a media column. */
export type MarginBeside = "message" | "image"

/** A shut margin's count: how many comments it holds. */
export const marginCountWords = (
  count: number,
  beside: MarginBeside,
): { readonly label: string; readonly title: string } => ({
  label: `💬 ${count}`,
  title: `${plural(count, "comment")} on this ${beside}: open them${beside === "message" ? " (Enter)" : ""}`,
})

/** The control that shuts an open margin. */
export const shutMarginWords = (beside: MarginBeside) =>
  ({
    label: "close",
    title: `close this ${beside}'s comments${beside === "message" ? " (Escape)" : ""}`,
  }) as const

/** The control that adds a comment in an open margin (`c` on a message). */
export const addCommentWords = (beside: MarginBeside) =>
  ({
    label: "+ comment",
    title: `add a comment on this ${beside}${beside === "message" ? " (c)" : ""}`,
  }) as const
