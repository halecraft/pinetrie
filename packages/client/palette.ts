// client/palette — the tracks' colours (ADR-0089, S110). A track is a
// branch's rank in its root (ADR-0068); its root's id picks the slot its
// trunk takes, and each later track steps on by `STRIDE`, so roots start on
// different colours and a root's branches spread round the palette. Pure.

import { PENDING_TRACK, type RootId } from "@pinetrie/core"

/**
 * Twelve colours at OKLCH lightness 0.72 and chroma 0.14, in hue order, so a
 * slot's neighbours are its nearest colours. S110 chose them: about 0.06
 * apart in OKLab at the closest, 0.08 or more from people's first colours,
 * the attention amber and the review's lines, and 6.8:1 or more on
 * `--page`. `index.html` has a
 * hover rule pair per slot (`palette.test.ts`).
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

/** Coprime with the palette's 12, near 12/φ: neighbouring tracks land 5 slots apart. */
export const STRIDE = 7

/** A fresh branch, which has no track yet. */
export const PENDING_COLOR = "#777"

/** A colour slot: a palette index, or a fresh branch's. */
export type ColorSlot = number | "pending"

/** A string's 32-bit hash: a person's colour (`presence.tsx`) and a root's seed. */
export function stringHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1)
    h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  return h
}

/** The slot a root's trunk takes: the same on every device, written nowhere. */
export const rootSeed = (root: RootId): number =>
  stringHash(root) % PALETTE.length

/** Track `track`'s slot in a root seeded `seed`. */
export const trackSlot = (seed: number, track: number): ColorSlot =>
  track === PENDING_TRACK ? "pending" : (seed + STRIDE * track) % PALETTE.length

export const slotColor = (slot: ColorSlot): string =>
  slot === "pending" ? PENDING_COLOR : (PALETTE[slot] ?? PENDING_COLOR)

/** A root's colour: its trunk's, on the rail and in its first column. */
export const rootColor = (root: RootId): string =>
  slotColor(trackSlot(rootSeed(root), 0))
