// client/use-narrow — whether the window is too narrow for the pane beside
// the thread (`NARROW`, ADR-0078).

import { useSyncExternalStore } from "react"
import { NARROW } from "./pane.ts"

let list: MediaQueryList | null = null
/** One list for the page, made when a pane first asks. */
const query = (): MediaQueryList => {
  list ??= window.matchMedia(NARROW)
  return list
}

const subscribe = (change: () => void): (() => void) => {
  const at = query()
  at.addEventListener("change", change)
  return () => at.removeEventListener("change", change)
}

const narrow = (): boolean => query().matches

/** Whether the pane covers the page, kept as the window crosses `NARROW`. */
export const useNarrow = (): boolean => useSyncExternalStore(subscribe, narrow)
