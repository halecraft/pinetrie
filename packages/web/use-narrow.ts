// web/use-narrow — whether the strip is too narrow for the pane beside the
// thread (`narrowStrip`). `App` measures the strip and provides the answer; a
// pane reads it.

import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { narrowStrip } from "./pane.ts"

/** Whether the pane covers the page. False until the strip is measured. */
export const NarrowContext = createContext(false)

/** What `App` provides as `NarrowContext`. */
export const useNarrow = (): boolean => useContext(NarrowContext)

const remPx = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize)

/**
 * Whether the strip in `strip` is too narrow, kept as it resizes: the sidebar
 * folding or unfolding, or the window. The strip comes and goes with what
 * the stage shows, so each render checks whether it is still the element
 * observed. State changes only when the answer does.
 */
export function useStripNarrow(strip: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  const observed = useRef<{
    readonly el: HTMLElement
    readonly observer: ResizeObserver
  } | null>(null)
  useLayoutEffect(() => {
    const el = strip.current
    if (el === (observed.current?.el ?? null)) return
    observed.current?.observer.disconnect()
    observed.current = null
    if (el === null) return
    const measure = () => setNarrow(narrowStrip(el.clientWidth, remPx()))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observed.current = { el, observer }
  })
  useEffect(() => () => observed.current?.observer.disconnect(), [])
  return narrow
}
