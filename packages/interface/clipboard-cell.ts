// interface/clipboard-cell — what the clipboard cell beside the inventory's
// grid shows (ADR-0132): the last copy this tab made, never a slot. No page
// can read the system clipboard before a paste, so it says no more than
// that: "last copied here". Pure.

import { firstLine } from "@pinetrie/core"
import { firstEmpty, type Slots } from "@pinetrie/session"
import { addressWords } from "./address-words.ts"
import { CLIPBOARD_CELL, CLIPBOARD_CELL_TITLE } from "./card-words.ts"
import type { CardClip, Clip } from "./clip.ts"

/** How the cell draws its copy: what it is ("a message", "a thread", "text") and its first line. */
export interface CellFace {
  readonly words: string
  readonly line: string
}

export interface ClipboardCellView {
  readonly face: CellFace
  /** The cell's heading. */
  readonly words: string
  readonly title: string
  /** Whether **keep** is offered: a slot is free for its copy. */
  readonly keep: boolean
}

/** The cell for `clip`, the last copy this tab made; null before any. */
export function clipboardCellView(
  clip: Clip | null,
  slots: Slots,
): ClipboardCellView | null {
  if (clip === null) return null
  return {
    face: cellFace(clip),
    words: CLIPBOARD_CELL,
    title: CLIPBOARD_CELL_TITLE,
    keep: firstEmpty(slots) !== null,
  }
}

/** How long a line the cell shows, as a slot's face does. */
const LINE = 60

function cellFace(clip: Clip): CellFace {
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
  task: "a task",
}
