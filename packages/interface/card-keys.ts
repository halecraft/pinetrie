// interface/card-keys — the keys a card's own box takes for what the card
// does in its place: Alt+↑ and Alt+↓ move a card in a list one place up or
// down, and Ctrl+Shift+Backspace discards a card.
//
// Only boxes of a card in a list (queued, pinned, a note, a new card's box)
// take Alt+↑/↓. On a Mac, Option+↑/↓ moves a textarea's caret to its
// paragraph's start or end; those boxes lose that, and the composer keeps it. Ctrl, not Cmd, as take
// (Ctrl+Shift+I) and put (Ctrl+Shift+O) are: Cmd+Backspace deletes the line.

import type { CardId } from "@pinetrie/core"
import type { ColumnAct } from "./intent.ts"
import type { KeyLike } from "./page-keys.ts"

/**
 * The act a key in a card's box asks for, or null. `among` is its list as
 * drawn when it has a place in line, else null: only such a card reorders.
 */
export function cardKeyAct(
  event: KeyLike & { readonly isComposing: boolean },
  card: CardId,
  among: readonly CardId[] | null,
): ColumnAct | null {
  if (event.isComposing || event.metaKey) return null
  if (event.ctrlKey && event.shiftKey && !event.altKey)
    return event.key === "Backspace" ? { kind: "discard", card } : null
  if (!event.altKey || event.ctrlKey || event.shiftKey || among === null)
    return null
  if (event.key === "ArrowUp") return { kind: "reorder", card, among, step: -1 }
  if (event.key === "ArrowDown")
    return { kind: "reorder", card, among, step: 1 }
  return null
}

/**
 * What a key in the box a new card is written in asks for: the column acts,
 * in order, and whether the box then lets its card go to its list. A move
 * hands the card to the list, armed to take focus there.
 */
export function newCardKeys(
  event: KeyLike & { readonly isComposing: boolean },
  card: CardId,
  among: readonly CardId[],
): { readonly acts: readonly ColumnAct[]; readonly release: boolean } {
  const act = cardKeyAct(event, card, among)
  if (act === null) return { acts: [], release: false }
  return {
    acts: act.kind === "reorder" ? [act, { kind: "focusCard", card }] : [act],
    release: true,
  }
}
