// interface/column-menu — what a card column's head ends in, as values: its
// ⋯, what changes the canvas everyone shares, ending in its trash; then one
// button that is yours or loses nothing: ⇤, or the bin on a thread not yet
// started.

import { type CardId, type CardWidth, isThreadId } from "@pinetrie/core"
import { moveWords } from "./card-frame.ts"
import type { ControlWords } from "./card-words.ts"
import { FOLD } from "./folded-column-view.ts"
import type { Intent } from "./intent.ts"

export interface ColumnMenuItem {
  readonly key: string
  readonly label: string
  readonly title: string
  readonly intent: Intent
}

/** A run of a column's ⋯: the canvas's own items, a thread's, or its trash. */
export interface ColumnMenuSection {
  readonly key: "canvas" | "thread" | "trash"
  readonly items: readonly ColumnMenuItem[]
}

/** A button of a head: what it says, and what a press asks. */
export interface HeadButton {
  readonly words: ControlWords
  readonly intent: Intent
}

/** What a card column's head ends in, after its name: its ⋯, then one button or none. */
interface HeadEnd {
  readonly menu: readonly ColumnMenuSection[]
  readonly button: HeadButton | null
}

/** The title of the bin and of Move to trash: the card goes to the canvas's trash, for everyone. */
const TRASH_COLUMN =
  "trash this column, for everyone: anyone on the canvas restores it from the canvas's trash"

/**
 * The bin on a thread not yet started: the ⋯'s Move to trash, in one click.
 * Drawn as a bin, never ×, which only ever closes.
 */
const TRASH: ControlWords = {
  label: "trash",
  title: TRASH_COLUMN,
  className: "trash-column",
}

/** What the ⋯'s Move to trash and the bin both ask, built once so the two cannot differ. */
const trashIntent = (card: CardId): Intent => ({
  kind: "discard",
  card,
  // A card's column is keyed by its card.
  at: { kind: "column", key: card },
})

/**
 * What a card column's head ends in, for its card `card`, now `width`
 * columns wide. ⋯ holds what is everyone's; the button is yours or loses
 * nothing, so a thread not yet started closes there and does not fold.
 */
export function columnHeadEnd(input: {
  readonly card: CardId
  readonly width: CardWidth
  /** Whether the reader may trash it: no trash in ⋯, and no bin, otherwise. */
  readonly writable: boolean
  /** A thread not yet started (`isNextSendBranch`); false for a note column. */
  readonly unstarted: boolean
}): HeadEnd {
  const { card } = input
  return {
    menu: columnMenu(input),
    button: !input.unstarted
      ? { words: FOLD, intent: { kind: "fold", card, unfolded: false } }
      : input.writable
        ? { words: TRASH, intent: trashIntent(card) }
        : null,
  }
}

/**
 * What a column's ⋯ offers, all of it everyone's. It lists no canvas: a
 * thread reaches another canvas through your inventory. It ends in Move to
 * trash on every column, even where the bin repeats it, so it reads the same on
 * each.
 */
function columnMenu(input: {
  readonly card: CardId
  readonly width: CardWidth
  readonly writable: boolean
}): readonly ColumnMenuSection[] {
  const wide = input.width === 2
  const canvas: ColumnMenuSection = {
    key: "canvas",
    items: [
      {
        key: "width",
        label: wide ? "Make narrow" : "Make wide",
        title: wide
          ? "draw it one column wide, for everyone"
          : "draw it two columns wide, for everyone",
        intent: { kind: "cardWidth", card: input.card, width: wide ? 1 : 2 },
      },
    ],
  }
  const trash: readonly ColumnMenuSection[] = input.writable
    ? [
        {
          key: "trash",
          items: [
            {
              key: "trash",
              label: "Move to trash",
              title: TRASH_COLUMN,
              intent: trashIntent(input.card),
            },
          ],
        },
      ]
    : []
  if (!isThreadId(input.card)) return [canvas, ...trash]
  const source = input.card
  return [
    canvas,
    {
      key: "thread",
      items: [
        {
          key: "copy",
          label: "Copy to this canvas",
          title: "a new thread forked at this one's end, just after it",
          intent: { kind: "copyThread", source, to: "here" },
        },
        {
          key: "copy-inventory",
          label: "Copy to your inventory",
          title: "a new thread forked at this one's end, in your inventory",
          intent: { kind: "copyThread", source, to: "inventory" },
        },
        {
          key: "take",
          label: moveWords("inventory").label,
          title:
            "put this thread away: its run stops, and only you can open it",
          intent: { kind: "takeIntoInventory", card: source },
        },
      ],
    },
    ...trash,
  ]
}

/** The ⋯'s own name, for a screen reader. */
export const COLUMN_MENU_LABEL = "more for this column"
