// client/tool-row — how much of a tool call's row is shown, and what it
// shows, as pure rules.
//
// A row opens on its own, capped, for a call whose output streams for
// REVEAL_MS, so a fast command never flashes open, and for a result with an
// image (ADR-0051). Nothing but the reader closes it or shows it whole: a
// following column that grew for a row does not shrink when the call ends
// (S35).

import type { ImageRef, ToolResultView } from "@pineta/core"

/** How long a call's output streams before its row opens. */
export const REVEAL_MS = 500

/**
 * `closed`: the summary line. `capped`: opened by the work, its command and
 * output each scrolling in a capped box. `full`: opened by the reader, uncapped.
 */
export type RowSize = "closed" | "capped" | "full"

/** The reader's last choice, or null before they made one. */
export type ReaderChoice = "full" | "closed" | null

/**
 * What a row decides for itself. It outlives the row, kept by its call's id,
 * since a tab shown again mounts its columns anew (ADR-0049).
 */
export interface RowMemory {
  /** The call's output streamed for REVEAL_MS while this row was drawn. */
  readonly revealed: boolean
  readonly reader: ReaderChoice
}

/** A row never drawn before. */
export const NO_MEMORY: RowMemory = { revealed: false, reader: null }

export interface RowFacts extends RowMemory {
  /** Its result has an image. */
  readonly shows: boolean
}

export const rowSize = (f: RowFacts): RowSize =>
  f.reader ?? (f.revealed || f.shows ? "capped" : "closed")

/** A capped row is partly open already: a click shows the rest. */
export const click = (size: RowSize): "full" | "closed" =>
  size === "full" ? "closed" : "full"

/**
 * What an open row draws: a result's images in place of its text, whose
 * caption only says an image was read, or else its text or live output.
 * `note` is that text: the caption, and pi's note of a resize.
 */
export type ToolBody =
  | {
      readonly kind: "images"
      readonly images: readonly ImageRef[]
      readonly note: string
    }
  | { readonly kind: "text" }

export const toolBody = (result: ToolResultView | undefined): ToolBody =>
  result !== undefined && result.images.length > 0
    ? { kind: "images", images: result.images, note: result.text }
    : { kind: "text" }
