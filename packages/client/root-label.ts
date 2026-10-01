// client/root-label — what a root is called on screen (ADR-0045), and the
// tab's rename field's submit. Pure.

import {
  firstLine,
  type MarkRecord,
  messageText,
  parseTitle,
  type RootSummary,
  type TreeIndex,
} from "@pineta/core"

/** A root whose first message has no text, or no message yet, is called this. */
export const NO_TEXT = "(no text)"

/** Every root's first message's first line: its label while it has no title. */
export function firstLines(
  summaries: readonly RootSummary[],
  index: TreeIndex,
): ReadonlyMap<string, string> {
  return new Map(
    summaries.map(s => [
      s.root,
      firstLine(messageText(index.entries[s.first]?.message), 40) || NO_TEXT,
    ]),
  )
}

/**
 * Every root's label: its mark's title, else its first line. `App` builds it
 * once per change, and the tabs, the header, the inbox and the Archive tab
 * look labels up in it.
 */
export function rootLabels(
  lines: ReadonlyMap<string, string>,
  marks: ReadonlyMap<string, MarkRecord>,
): ReadonlyMap<string, string> {
  return new Map(
    [...lines].map(([root, line]) => [root, marks.get(root)?.title ?? line]),
  )
}

export type TitlePlan =
  | { readonly kind: "refuse" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "send"; readonly title: string | null }

/** The rename field's submit. `stored` is the root's title, null when it has none. */
export function planTitle(typed: string, stored: string | null): TitlePlan {
  const input = parseTitle(typed)
  switch (input.kind) {
    case "invalid":
      return { kind: "refuse" }
    case "clear":
      return stored === null
        ? { kind: "unchanged" }
        : { kind: "send", title: null }
    case "set":
      return input.title === stored
        ? { kind: "unchanged" }
        : { kind: "send", title: input.title }
  }
}

/**
 * What a key does in the rename field: Enter saves, Escape cancels, and both
 * give the tab focus back. Null for any other key. Leaving the field saves
 * too, and leaves focus where it went.
 */
export function renameKey(
  key: string,
): { readonly save: boolean; readonly refocus: true } | null {
  if (key === "Enter") return { save: true, refocus: true }
  if (key === "Escape") return { save: false, refocus: true }
  return null
}
