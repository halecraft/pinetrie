// web/use-small-window — whether the window is small (`SMALL`,
// ADR-0088): your list shows icons there until you choose.

import { useSyncExternalStore } from "react"

/** Narrower than this, a list nobody has chosen for shows icons: `--side`'s own line. */
export const SMALL = "(width < 56rem)"

let list: MediaQueryList | null = null
/** One list for the page, made when it is first asked. */
const query = (): MediaQueryList => {
  list ??= window.matchMedia(SMALL)
  return list
}

const subscribe = (change: () => void): (() => void) => {
  const at = query()
  at.addEventListener("change", change)
  return () => at.removeEventListener("change", change)
}

const small = (): boolean => query().matches

/** Whether the window is small, kept as it crosses `SMALL`. */
export const useSmallWindow = (): boolean =>
  useSyncExternalStore(subscribe, small)
