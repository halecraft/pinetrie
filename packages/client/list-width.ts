// client/list-width — your list full or folded to icons (ADR-0088). The
// choice is this browser tab's, a new tab starting from the device's latest
// (`tabState`); until you choose, a small window shows icons. Pure.

import type { Codec } from "./tab-state.ts"

export type ListWidth = "full" | "icons"

const WIDTHS: readonly ListWidth[] = ["full", "icons"]

/** The key the choice is kept under, in both slots. */
export const LIST_KEY = "pinetrie-list"

/** Narrower than this, a list nobody has chosen for shows icons: `--side`'s own line. */
export const SMALL = "(width < 56rem)"

export const listWidthCodec: Codec<ListWidth> = {
  encode: width => width,
  decode: (raw: unknown) => WIDTHS.find(w => w === raw),
}

/** What the list shows: your choice, else icons on a small window. */
export const shownWidth = (
  chosen: ListWidth | undefined,
  small: boolean,
): ListWidth => chosen ?? (small ? "icons" : "full")

/** The other width: what folding or unfolding gives. */
export const otherWidth = (width: ListWidth): ListWidth =>
  width === "full" ? "icons" : "full"

/** The key that folds and unfolds the list, from anywhere (`keyAct`). */
export const FOLD_KEY = "Ctrl+Shift+L"

/** The control at the list's foot, by what it does from `shown`. */
export function listFoldWords(shown: ListWidth): {
  readonly glyph: string
  readonly label: string
  readonly title: string
} {
  const label =
    shown === "full" ? "fold your list to icons" : "show your list's titles"
  return {
    glyph: shown === "full" ? "«" : "»",
    label,
    title: `${label} (${FOLD_KEY})`,
  }
}
