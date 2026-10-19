// interface/column-menu — a card column's head, folded or not, as values. It
// starts with its toggle, ⇤ or ⇥, yours alone, or the bin on a thread not yet
// started, and the card's box, everyone's; after its name, its status button,
// which opens its details; an unfolded head ends in its ⋯, what changes the
// canvas everyone shares, ending in its trash.

import { isThreadId } from "@pinetrie/core"
import type { CardId, CardWidth } from "@pinetrie/threads"
import { moveWords } from "./card-frame.ts"
import {
  type ControlWords,
  NEW_PIN_TITLE,
  PIN_A_CARD,
  RENAME,
} from "./card-words.ts"
import { foldToggle } from "./folded-column-view.ts"
import type { Intent } from "./intent.ts"

/**
 * An item of a column's ⋯: one that asks an intent, or one the page opens
 * itself (its title field, its pin box), as the sidebar's Rename is.
 */
type ColumnMenuItem = {
  readonly key: string
  readonly label: string
  readonly title: string
} & (
  | { readonly kind: "intent"; readonly intent: Intent }
  | { readonly kind: "rename" }
  | { readonly kind: "pin" }
)

/** A run of a column's ⋯: the canvas's own items, a thread's, or its trash. */
export interface ColumnMenuSection {
  readonly key: "canvas" | "thread" | "trash"
  readonly items: readonly ColumnMenuItem[]
}

/** A button of a head: what it says, and what a press asks. */
interface HeadButton {
  readonly words: ControlWords
  readonly intent: Intent
}

/** A column's box: whether it is ticked, what it says, and what a press asks; null intent for a reader who may not change it. */
interface HeadBox {
  readonly ticked: boolean
  readonly title: string
  readonly intent: Intent | null
}

/**
 * A card column's head, folded or not, in its order: the toggle first, so
 * it stays where it is as the column folds; the box; then, unfolded, its ⋯
 * at the end.
 */
export interface ColumnHead {
  /** ⇤ or ⇥, or the bin on a thread not yet started; null for none. */
  readonly toggle: HeadButton | null
  readonly box: HeadBox
  /** ⋯, unfolded only: a column is unfolded to act on it. */
  readonly menu: readonly ColumnMenuSection[]
  /**
   * What its status button asks: the details' other state. Opening a folded
   * column's details unfolds it first (`unfoldFirst`, `intent.ts`).
   */
  readonly status: Intent
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
  kind: "trash",
  card,
  // A card's column is keyed by its card.
  at: { kind: "column", key: card },
})

/** What a column's box says, by whether it is ticked and whether the reader may change it. */
const boxTitle = (ticked: boolean, writable: boolean): string =>
  !writable
    ? ticked
      ? "its box is ticked: only someone who may change this canvas changes it"
      : "only someone who may change this canvas ticks its box"
    : ticked
      ? "clear this column's box, for everyone"
      : "tick this column's box, for everyone: it means what you mean, done or set aside"

/**
 * A card column's head, for its card `card`, now `width` columns wide,
 * folded or not. The toggle is yours or loses nothing, so a thread not yet
 * started trashes there and does not fold; the box and ⋯ are everyone's.
 */
export function columnHead(input: {
  readonly card: CardId
  readonly width: CardWidth
  /** Whether the reader may change the canvas: no trash, no bin and no box to change, otherwise. */
  readonly writable: boolean
  /** A thread not yet started (`isNextSendBranch`); false for a note column. */
  readonly unstarted: boolean
  readonly folded: boolean
  readonly ticked: boolean
  /** Its details are open. */
  readonly details: boolean
  /** Its ⋯ offers Pin a card (`newPinPlace` says `menu`). */
  readonly pin: boolean
  /** Its ⋯ offers Rename: a list column a reader may write. */
  readonly renamable: boolean
}): ColumnHead {
  const { card, folded, ticked, writable } = input
  return {
    toggle: !input.unstarted
      ? {
          words: foldToggle(folded),
          intent: { kind: "fold", card, unfolded: folded },
        }
      : writable
        ? { words: TRASH, intent: trashIntent(card) }
        : null,
    box: {
      ticked,
      title: boxTitle(ticked, writable),
      intent: writable ? { kind: "card-tick", card, ticked: !ticked } : null,
    },
    menu: folded ? [] : columnMenu(input),
    status: {
      kind: "column",
      column: { kind: "card", card },
      act: { kind: "details", open: !input.details },
    },
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
  readonly pin: boolean
  readonly renamable: boolean
}): readonly ColumnMenuSection[] {
  const wide = input.width === 2
  const canvas: ColumnMenuSection = {
    key: "canvas",
    items: [
      ...(input.renamable
        ? [
            {
              kind: "rename",
              key: "rename",
              label: RENAME,
              title: "change this column's title, for everyone",
            } as const,
          ]
        : []),
      ...(input.pin
        ? [
            {
              kind: "pin",
              key: "pin",
              label: PIN_A_CARD,
              title: NEW_PIN_TITLE,
            } as const,
          ]
        : []),
      {
        kind: "intent",
        key: "width",
        label: wide ? "Make narrow" : "Make wide",
        title: wide
          ? "draw it one column wide, for everyone"
          : "draw it two columns wide, for everyone",
        intent: { kind: "card-width", card: input.card, width: wide ? 1 : 2 },
      },
    ],
  }
  const trash: readonly ColumnMenuSection[] = input.writable
    ? [
        {
          key: "trash",
          items: [
            {
              kind: "intent",
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
          kind: "intent",
          key: "copy",
          label: "Copy to this canvas",
          title: "a new thread forked at this one's end, just after it",
          intent: { kind: "copy-thread", source, to: "here" },
        },
        {
          kind: "intent",
          key: "copy-inventory",
          label: "Copy to your inventory",
          title: "a new thread forked at this one's end, in your inventory",
          intent: { kind: "copy-thread", source, to: "inventory" },
        },
        {
          kind: "intent",
          key: "take",
          label: moveWords("inventory").label,
          title:
            "put this thread away: its run stops, and only you can open it",
          intent: { kind: "put-away", card: source },
        },
      ],
    },
    ...trash,
  ]
}

/** The ⋯'s own name, for a screen reader. */
export const COLUMN_MENU_LABEL = "more for this column"
