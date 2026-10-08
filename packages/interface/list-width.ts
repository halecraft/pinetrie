// interface/list-width — the sidebar full or folded to icons (ADR-0088). The
// choice is kept by each client: the page's is this browser tab's, a new tab
// starting from the device's latest (`tabState`). Until you choose, a small
// window shows icons. Pure.

import type { Codec } from "./codec.ts"

export type ListWidth = "full" | "icons"

const WIDTHS: readonly ListWidth[] = ["full", "icons"]

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
    shown === "full" ? "fold the sidebar to icons" : "show the sidebar's titles"
  return {
    glyph: shown === "full" ? "«" : "»",
    label,
    title: `${label} (${FOLD_KEY})`,
  }
}
