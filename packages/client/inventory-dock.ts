// client/inventory-dock — where the inventory panel floats (ADR-0048): left,
// centre or right, the nearest third to where its frame is dropped. Kept per
// device, not per session. Pure.

import type { Codec } from "./tab-state.ts"

export type Dock = "left" | "centre" | "right"

export const DOCKS: readonly Dock[] = ["left", "centre", "right"]

/** The key the dock is kept under in `localStorage`. */
export const DOCK_KEY = "pinetrie-inventory-dock"

/** The third of a `width`-wide screen that `x` falls in. */
export function snapTo(x: number, width: number): Dock {
  if (width <= 0 || x < width / 3) return "left"
  return x < (2 * width) / 3 ? "centre" : "right"
}

export const dockCodec: Codec<Dock> = {
  encode: dock => dock,
  decode: (raw: unknown) => DOCKS.find(d => d === raw),
}
