// web/focus-claim — who may take focus as it mounts: what a plan armed
// (`claimFocus`, `@pinetrie/interface`). `App` provides it; a composer, the
// board's search and a card's box claim their own key.

import type { FocusKey } from "@pinetrie/interface"
import { createContext, useContext } from "react"

/**
 * Whether `key` takes focus now, which disarms it: call it inside an effect.
 * `App` provides one function of fixed identity: a new one each render would
 * draw every claimer again on every `App` render, and run again every effect
 * that lists it.
 */
export const FocusClaim = createContext<(key: FocusKey) => boolean>(() => false)

export const useFocusClaim = (): ((key: FocusKey) => boolean) =>
  useContext(FocusClaim)
