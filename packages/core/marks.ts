// core/marks — titles: what a canvas's or a note column's typed title asks
// for.

import type { CanvasId, NoteColumnId } from "./ids.ts"

/** What a title names: a canvas, or a note column. */
export type MarkTarget =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "note-column"; readonly column: NoteColumnId }

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
