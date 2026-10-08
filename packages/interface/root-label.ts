// interface/root-label — what a root is called on screen (ADR-0045), and the
// tab's rename field's submit. Pure.

import {
  type EntryId,
  type LaneName,
  type LaneRecord,
  NO_TEXT,
  parseTitle,
  type RootId,
  type RootRecord,
  type RootSummary,
} from "@pinetrie/core"

export { NO_TEXT }

/** The directory's roots that have a message, by their root entry. */
const withEntries = (directory: ReadonlyMap<RootId, RootRecord>) =>
  [...directory.values()].flatMap(r =>
    r.entry === null ? [] : [{ ...r, entry: r.entry }],
  )

/** Messages in the roots this tab holds, of every root's. */
export interface MessageCount {
  readonly held: number
  readonly total: number
}

/** Summed from the directory (ADR-0063), so a root not held counts in `total`. */
export const messageCount = (
  directory: ReadonlyMap<RootId, RootRecord>,
  held: ReadonlySet<RootId>,
): MessageCount => {
  let total = 0
  let inHeld = 0
  for (const r of directory.values()) {
    total += r.messages
    if (held.has(r.root)) inHeld += r.messages
  }
  return { held: inHeld, total }
}

/** The count's tooltip: ▦'s, in the footer (ADR-0112). */
export const messageCountTitle = ({ held, total }: MessageCount): string =>
  `${held} in the threads this tab has loaded, of ${total} in the session`

/**
 * Every root with a message, ascending by its root entry, as your list and
 * the board read it: from the directory (ADR-0063), not the tree, so a
 * root this tab does not hold is there too.
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

/** What an untitled root no agent has worked in is called (ADR-0074). */
export const CHAT_LABEL = "Chat"

/**
 * Every root's label, by its root entry: its title; else, for a root no lane
 * works in (only people have written there), `CHAT_LABEL`; else its first
 * line. `App` builds it once per change, and your list, the board and your
 * inbox look labels up in it.
 */
export function labelsOf(
  directory: ReadonlyMap<RootId, RootRecord>,
  lanes: ReadonlyMap<LaneName, LaneRecord>,
): ReadonlyMap<EntryId, string> {
  const worked = new Set([...lanes.values()].map(l => l.root))
  return new Map(
    withEntries(directory).map(r => [
      r.entry,
      r.title ?? (worked.has(r.root) ? r.firstLine : CHAT_LABEL),
    ]),
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

/**
 * What a folded list draws for a root without a sprite (ADR-0088): the first
 * letters of the label's first two words, or a one-word label's first two
 * letters, in capitals. A word is a run of letters and digits.
 */
export function initialsOf(label: string): string {
  const words = label.match(/[\p{L}\p{N}]+/gu) ?? []
  const [first = "", second] = words
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [Array.from(first)[0] ?? "", Array.from(second)[0] ?? ""]
  return letters.join("").toLocaleUpperCase()
}
