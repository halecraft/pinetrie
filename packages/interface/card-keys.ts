// interface/card-keys — the keys a card's own box takes for what the card does
// in its place (ADR-0048, *Physics* 5): Alt+↑ and Alt+↓ move a queued or
// pinned card one place up or down. Pure: a key and the card's list as
// drawn, to an act or nothing. The key-system redesign replaces this file.
//
// Only queued and pinned boxes ask. On a Mac, Option+↑/↓ moves a textarea's
// caret to its paragraph's start or end; those boxes lose that, and the
// composer and drafting cards keep it.

import type { CardId } from "@pinetrie/core"
import type { ColumnAct } from "./intent.ts"
import type { KeyLike } from "./inventory-keys.ts"

/** The act a key in a queued or pinned card's box asks for, or null. */
export function cardKeyAct(
  event: KeyLike & { readonly isComposing: boolean },
  card: CardId,
  among: readonly CardId[],
): ColumnAct | null {
  if (
    event.isComposing ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null
  if (event.key === "ArrowUp") return { kind: "reorder", card, among, step: -1 }
  if (event.key === "ArrowDown")
    return { kind: "reorder", card, among, step: 1 }
  return null
}
