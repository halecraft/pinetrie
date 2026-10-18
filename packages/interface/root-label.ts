// interface/root-label — what a canvas is called on screen, and the rename
// field's submit.

import {
  type CanvasId,
  type EntryId,
  type LaneRecord,
  NO_TEXT,
  parseTitle,
  type RootId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import type { MarkRecord, RootRecord } from "@pinetrie/rules"
import type { Canvases } from "./canvases.ts"

export { NO_TEXT }

/** Messages in the roots this tab holds, of every root's. */
export interface MessageCount {
  readonly held: number
  readonly total: number
}

/** Summed from the directory, so a root not held counts in `total`. */
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

/** The count's tooltip: ▦'s, in the footer. */
export const messageCountTitle = ({ held, total }: MessageCount): string =>
  `${held} in the threads this tab has loaded, of ${total} in the session`

/** What a canvas's card shows of its threads' roots, from the directory. */
export interface CanvasSummary {
  /** Its first root's first message's first line: its label while it has no title. */
  readonly line: string
  /** Everyone who wrote a chat in its roots, in order of first message, each root in turn. */
  readonly writers: readonly WriterId[]
  /** Its newest message: last activity, since ids are uuidv7. */
  readonly newest: EntryId
}

/**
 * Every canvas with a message, as the sidebar and the board read it: from the
 * directory, not the tree, so a root this tab does not hold counts too. A canvas
 * whose first root has no message yet is left out.
 */
export function taskSummaries(
  canvases: Canvases,
  directory: ReadonlyMap<RootId, RootRecord>,
): ReadonlyMap<CanvasId, CanvasSummary> {
  const out = new Map<CanvasId, CanvasSummary>()
  for (const t of canvases.byId.values()) {
    const records = t.roots.flatMap(r => directory.get(r) ?? [])
    const first = records[0]
    if (first === undefined || first.first === null) continue
    const writers: WriterId[] = []
    let newest: EntryId = first.first
    for (const r of records) {
      for (const w of r.writers) if (!writers.includes(w)) writers.push(w)
      const latest = r.newest ?? r.first
      if (latest !== null && latest > newest) newest = latest
    }
    out.set(t.canvas, { line: first.firstLine, writers, newest })
  }
  return out
}

/** What an untitled canvas no agent has worked in is called. */
export const CHAT_LABEL = "Chat"

/**
 * Every canvas's label: its title; else its first card's: for a thread no lane
 * works in (only people have written there) `CHAT_LABEL`, else its root's first
 * line. `App` builds it once per change, and the sidebar, the board and your
 * inbox look labels up in it.
 */
export function taskLabels(input: {
  readonly canvases: Canvases
  readonly marks: ReadonlyMap<CanvasId, MarkRecord>
  readonly directory: ReadonlyMap<RootId, RootRecord>
  readonly lanes: ReadonlyMap<ThreadId, LaneRecord>
}): ReadonlyMap<CanvasId, string> {
  const worked = new Set([...input.lanes.values()].map(l => l.root))
  return new Map(
    [...input.canvases.byId.values()].map(t => {
      const title = input.marks.get(t.canvas)?.title
      if (title !== undefined) return [t.canvas, title] as const
      const root = t.roots[0]
      const record = root === undefined ? undefined : input.directory.get(root)
      return [
        t.canvas,
        record === undefined
          ? NO_TEXT
          : worked.has(record.root)
            ? record.firstLine
            : CHAT_LABEL,
      ] as const
    }),
  )
}

type TitlePlan =
  | { readonly kind: "refuse" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "send"; readonly title: string | null }

/** The rename field's submit. `stored` is the canvas's title, null when it has none. */
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
 * What a folded list draws for a root without a sprite: the first letters of
 * the label's first two words, or a one-word label's first two letters, in
 * capitals. A word is a run of letters and digits.
 */
export function labelInitials(label: string): string {
  const words = label.match(/[\p{L}\p{N}]+/gu) ?? []
  const [first = "", second] = words
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [Array.from(first)[0] ?? "", Array.from(second)[0] ?? ""]
  return letters.join("").toLocaleUpperCase()
}
