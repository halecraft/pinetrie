// interface/margin — an entry's margin as its column draws it: its comments,
// notes that people read and the agent does not. Shut, the margin is a face
// beside its entry, the count of its comments; open, its comments drawn normal
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

/** A shut margin's face: how many comments it holds. */
export const marginFaceWords = (
  count: number,
): { readonly label: string; readonly title: string } => ({
  label: `💬 ${count}`,
  title: `${plural(count, "comment")} on this message: open them (Enter)`,
})

/** The control that shuts an open margin. */
export const SHUT_MARGIN = {
  label: "shut",
  title: "shut this message's comments (Escape)",
} as const

/** The control that adds a comment in an open margin (`c` on the message). */
export const ADD_COMMENT = {
  label: "+ comment",
  title: "add a comment on this message (c)",
} as const
