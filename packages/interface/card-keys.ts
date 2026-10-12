// interface/card-keys — the keys a card's own box takes for what the card
// does in its place: Alt+↑ and Alt+↓ move a queued or pinned card one place
// up or down, and Ctrl+Shift+Backspace discards a card.
//
// Only queued and pinned boxes take Alt+↑/↓. On a Mac, Option+↑/↓ moves a
// textarea's caret to its paragraph's start or end; those boxes lose that,
// and the composer and notes keep it. Ctrl, not Cmd, as take
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
