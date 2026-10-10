// web/colors — the page's colour for each palette slot (ADR-0089, S110).
// Which slot a track takes is `palette.ts`'s, the same in any client.

import type { ColorSlot } from "@pinetrie/interface"

/**
 * Twelve colours, one per slot, at OKLCH lightness 0.72 and chroma 0.14, in
 * hue order, so a slot's neighbours are its nearest colours. S110 chose
 * them: about 0.06 apart in OKLab at the closest, 0.08 or more from
 * people's first colours, the attention amber and the review's lines, and
 * 6.8:1 or more on `--page`. `index.html` has a hover rule pair per slot
 * (`colors.test.ts`).
 */
export const PALETTE: readonly string[] = [
  "#eb8656",
  "#dc932e",
  "#c0a320",
  "#9ab140",
  "#67bb6b",
  "#13c097",
  "#03b4e9",
  "#60a8fa",
  "#919afb",
  "#b68dec",
  "#d383d1",
  "#e67dac",
]

/** A branch not yet started, which has no track yet. */
export const PENDING_COLOR = "#777"

export const slotColor = (slot: ColorSlot): string =>
  slot === "pending" ? PENDING_COLOR : (PALETTE[slot] ?? PENDING_COLOR)
