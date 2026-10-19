// interface/focus-claim — what takes focus as it mounts: a plan arms one key
// (`arm-focus`), `App` holds it, and the element it names claims it once
// (`claimFocus`). One key is armed at a time, so the newest arm wins.

import type { CardId } from "@pinetrie/threads"

/** What a plan arms to take focus as it mounts. */
export type FocusKey =
  /** The composer of the column keyed `key`. */
  | { readonly kind: "column"; readonly key: string }
  /** The board's search. */
  | { readonly kind: "board" }
  /** The box of card `card`, once its text is bound. */
  | { readonly kind: "card"; readonly card: CardId }

const sameFocus = (a: FocusKey, b: FocusKey): boolean => {
  switch (a.kind) {
    case "column":
      return b.kind === "column" && a.key === b.key
    case "board":
      return b.kind === "board"
    case "card":
      return b.kind === "card" && a.card === b.card
  }
}

/**
 * Whether `key` takes focus as it mounts, and what stays armed: what you
 * just opened or made does, once. A column restored, or shown again with
 * its tab, leaves focus where it is.
 */
export function claimFocus(
  armed: FocusKey | null,
  key: FocusKey,
): { readonly focus: boolean; readonly armed: FocusKey | null } {
  return armed !== null && sameFocus(armed, key)
    ? { focus: true, armed: null }
    : { focus: false, armed }
}
