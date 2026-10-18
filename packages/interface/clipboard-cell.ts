// interface/clipboard-cell — what the clipboard chip in the inventory's
// header shows: the last copy this tab made, never a slot. No page can read
// the system clipboard before a paste, so it says no more than that.

import { firstLine, INVENTORY_SLOTS } from "@pinetrie/core"
import { firstEmpty, type Slots } from "@pinetrie/session"
import { addressWords } from "./address-words.ts"
import { CLIPBOARD_CELL, CLIPBOARD_CELL_TITLE } from "./card-words.ts"
import type { CardClip, Clip } from "./clip.ts"

/** How the cell draws its copy: what it is ("a message", "a thread", "text") and its first line. */
export interface ClipSummary {
  readonly words: string
  readonly line: string
}

export interface ClipboardCellView {
  readonly summary: ClipSummary
  /** The cell's heading. */
  readonly words: string
  readonly title: string
  /** Whether **save** is offered: a slot is free for its copy. */
  readonly save: boolean
}

/**
 * The cell for `clip`, the last copy this tab made; null before any. `held`
 * is how many cards your inventory holds: at `INVENTORY_SLOTS` keep is not
 * offered, whatever slot is drawn empty.
 */
export function clipboardCellView(
  clip: Clip | null,
  slots: Slots,
  held: number,
): ClipboardCellView | null {
  if (clip === null) return null
  return {
    summary: clipSummary(clip),
    words: CLIPBOARD_CELL,
    title: CLIPBOARD_CELL_TITLE,
    save: held < INVENTORY_SLOTS && firstEmpty(slots) !== null,
  }
}

/** How long a line the cell shows. */
const LINE = 60

function clipSummary(clip: Clip): ClipSummary {
  switch (clip.kind) {
    case "text":
      return { words: "text", line: firstLine(clip.text, LINE) }
    case "past":
      return {
        words: addressWords(clip.taken.address),
        line: firstLine(clip.taken.markdown, LINE),
      }
    case "card":
      return {
        words: `${CARD_WORDS[clip.of.kind]}${clip.cut ? ", cut" : ""}`,
        line: firstLine(clip.of.text, LINE),
      }
  }
}

/** A copied card's kind, in words. */
const CARD_WORDS: Readonly<Record<CardClip["kind"], string>> = {
  text: "a card",
  reference: "a reference",
  thread: "a thread",
  "note-column": "a note column",
  canvas: "a canvas",
}
