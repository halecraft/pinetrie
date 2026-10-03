// client/root-label — what a root is called on screen (ADR-0045), and the
// tab's rename field's submit. Pure.

import {
  type EntryId,
  NO_TEXT,
  parseTitle,
  type RootId,
  type RootRecord,
  type RootSummary,
} from "@pineta/core"

export { NO_TEXT }

/** The directory's roots that have a message, by their root entry. */
const withEntries = (directory: ReadonlyMap<RootId, RootRecord>) =>
  [...directory.values()].flatMap(r =>
    r.entry === null ? [] : [{ ...r, entry: r.entry }],
  )

/** Every root's messages, summed from the directory (ADR-0063). */
export const messagesIn = (
  directory: ReadonlyMap<RootId, RootRecord>,
): number => {
  let n = 0
  for (const r of directory.values()) n += r.messages
  return n
}

/**
 * Every root with a message, ascending by its root entry, as the tabs and
 * the Archive tab read it: from the directory (ADR-0063), not the tree, so a
 * root no tab holds is there too.
 */
export const summariesOf = (
  directory: ReadonlyMap<RootId, RootRecord>,
): readonly RootSummary[] =>
  withEntries(directory)
    .flatMap(r =>
      r.first === null
        ? []
        : [
            {
              root: r.entry,
              first: r.first,
              messages: r.messages,
              newest: r.newest ?? r.first,
              writers: r.writers,
            },
          ],
    )
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))

/** Every root's first message's first line, by its root entry: its label while it has no title. */
export const firstLinesOf = (
  directory: ReadonlyMap<RootId, RootRecord>,
): ReadonlyMap<EntryId, string> =>
  new Map(withEntries(directory).map(r => [r.entry, r.firstLine]))

/**
 * Every root's label, by its root entry: its title, else its first line.
 * `App` builds it once per change, and the tabs, the header, the inbox and
 * the Archive tab look labels up in it.
 */
export const labelsOf = (
  directory: ReadonlyMap<RootId, RootRecord>,
): ReadonlyMap<EntryId, string> =>
  new Map(withEntries(directory).map(r => [r.entry, r.title ?? r.firstLine]))

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
