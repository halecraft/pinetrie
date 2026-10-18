// core/marks — titles: a canvas's and a note column's, as recorded, and what a
// typed title asks for.

import type { AgentId, CanvasId, NoteColumnId, WriterId } from "./ids.ts"

/**
 * A canvas's title: a host-written `pinetrie.mark` value in the session, keyed by
 * the canvas's id, so a canvas has at most one.
 */
export interface MarkRecord {
  readonly canvas: CanvasId
  readonly title: string
  /** The person who set it, or the agent for a title it made unasked. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** What a title names: a canvas, or a note column. */
export type MarkTarget =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "note-column"; readonly column: NoteColumnId }

/**
 * A note column's title: a host-written `pinetrie.note-column` value in the
 * session, keyed by the column's id, absent while untitled. Who made the column
 * is its card's owner, and when is in its id.
 */
export interface NoteColumnRecord {
  readonly column: NoteColumnId
  readonly title: string
  /** The person who set it. */
  readonly by: WriterId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** A title's longest form, in UTF-16 code units. */
export const MAX_TITLE = 80

/** What a typed title asks for. */
export type TitleInput =
  | { readonly kind: "set"; readonly title: string }
  | { readonly kind: "clear" }
  | { readonly kind: "invalid" }

/**
 * A title as typed, trimmed: empty clears it; a line break, or more than
 * `MAX_TITLE`, is invalid. The codec and the page both decide by this, so
 * they accept the same titles.
 */
export function parseTitle(text: string): TitleInput {
  const title = text.trim()
  if (title === "") return { kind: "clear" }
  return /[\r\n]/.test(title) || title.length > MAX_TITLE
    ? { kind: "invalid" }
    : { kind: "set", title }
}
