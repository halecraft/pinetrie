// web/palette-context — the seed of the root you are on (ADR-0089), for
// everything drawn in a track's colour: the rail, a column, its fork dots,
// the narrow pane's dialog. `App` provides it; it changes only with the root,
// which remounts the columns anyway.

import { trackSlot } from "@pinetrie/interface"
import { type CSSProperties, createContext, useContext, useMemo } from "react"
import { slotColor } from "./colors.ts"

/** The palette slot the root you are on starts from (`rootSeed`). */
export const TrackSeed = createContext(0)

export interface TrackColors {
  readonly color: (track: number) => string
  /**
   * A track's slot as `data-color`, so CSS can link a column header with its
   * fork dots on hover without any component state.
   */
  readonly slot: (track: number) => string
  /**
   * A track's colour as `--track`, the one inline style of a track-coloured
   * element in a column: its CSS reads `var(--track)` for every colour it takes.
   */
  readonly style: (track: number) => CSSProperties
}

export function useTrackColors(): TrackColors {
  const seed = useContext(TrackSeed)
  return useMemo(
    () => ({
      color: track => slotColor(trackSlot(seed, track)),
      slot: track => String(trackSlot(seed, track)),
      style: track =>
        ({ "--track": slotColor(trackSlot(seed, track)) }) as CSSProperties,
    }),
    [seed],
  )
}
