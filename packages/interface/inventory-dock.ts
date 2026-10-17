// interface/inventory-dock — where the inventory panel floats: left,
// centre or right, the nearest third to where its frame is dropped. Kept per
// device, not per session.

import type { Codec } from "./codec.ts"

export type Dock = "left" | "centre" | "right"

const DOCKS: readonly Dock[] = ["left", "centre", "right"]

/** The third of a `width`-wide screen that `x` falls in. */
export function snapTo(x: number, width: number): Dock {
  if (width <= 0 || x < width / 3) return "left"
  return x < (2 * width) / 3 ? "centre" : "right"
}

export const dockCodec: Codec<Dock> = {
  encode: dock => dock,
  decode: (raw: unknown) => DOCKS.find(d => d === raw),
}
