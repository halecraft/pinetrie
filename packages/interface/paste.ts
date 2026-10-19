// interface/paste — a file shared into a card box: where it goes, and which
// files a paste or a drop brings. Its link is `shareMarkdown`'s
// (`@pinetrie/rules`), written once the host keeps the file (`upload.ts`).

import { blobKind, type Share } from "@pinetrie/core"
import { byteWords } from "@pinetrie/rules"

/** A selection in a text box, in UTF-16 offsets. */
export interface Selection {
  readonly start: number
  readonly end: number
}

/**
 * `snippet` in place of `selection`, on lines of its own: a newline is added
 * where it would touch other text. Returns the text and the cursor, after
 * the snippet. A selection past the text's end is clamped to it.
 */
export function insertSnippet(
  text: string,
  selection: Selection,
  snippet: string,
): { readonly text: string; readonly cursor: number } {
  const start = Math.min(selection.start, text.length)
  const end = Math.min(Math.max(selection.end, start), text.length)
  const before = text.slice(0, start)
  const after = text.slice(end)
  const head = before === "" || before.endsWith("\n") ? "" : "\n"
  const tail = after === "" || after.startsWith("\n") ? "" : "\n"
  const placed = `${before}${head}${snippet}`
  return { text: `${placed}${tail}${after}`, cursor: placed.length }
}

/**
 * Where a share goes, as it arrives: the box's selection while it has focus,
 * else the end of its text. A box no one is typing in reports its caret at 0,
 * which is never where a dropped file is meant to go.
 */
export const shareSelection = (box: {
  readonly focused: boolean
  readonly selection: Selection
  readonly length: number
}): Selection =>
  box.focused ? box.selection : { start: box.length, end: box.length }

/** Every file a paste or a drop brings, in order; none means an ordinary paste. */
export const pastedFiles = <F>(data: { readonly files: ArrayLike<F> }): F[] =>
  Array.from(data.files)

/** The image files among a paste's or a drop's, in order: what a picture takes. */
export function imageFiles<F extends { readonly type: string }>(data: {
  readonly files: ArrayLike<F>
}): F[] {
  return pastedFiles(data).filter(f => f.type.startsWith("image/"))
}

/** The button that opens the file picker on a card box. */
export const SHARE_FILE = "share a file"

/** While a share uploads: a send then would lack its link. */
export const UPLOADING = "uploading a file…"

/** What a box says of its shares: one uploading, files the host refused, or nothing. */
export function shareStatus(state: {
  readonly uploading: boolean
  readonly refused: readonly string[]
}): string {
  if (state.uploading) return UPLOADING
  return state.refused.length === 0
    ? ""
    : `not shared: ${state.refused.join("; ")}`
}

/** A shared file as its chip in a message reads. */
interface ShareChip {
  readonly name: string
  /** Its format and size: "PDF · 2.0 MB". */
  readonly meta: string
  /** The warning that its bytes hold a location; null when they hold none. */
  readonly location: string | null
  /** What a click does: open it beside the thread, or download it. */
  readonly opens: "pane" | "download"
}

/** A shared file's format: its name's extension, upper case, or "file". */
const formatOf = (name: string): string => {
  const dot = name.lastIndexOf(".")
  const ext = dot <= 0 ? "" : name.slice(dot + 1)
  return ext === "" || ext.includes(" ") ? "file" : ext.toUpperCase()
}

/** How a shared file's chip reads, and what a click on it does. */
export function shareChip(share: Share): ShareChip {
  return {
    name: share.name,
    meta: `${formatOf(share.name)} · ${byteWords(share.size)}`,
    location: share.hasLocation ? "holds a location" : null,
    opens: blobKind(share.original) === "opaque" ? "download" : "pane",
  }
}
