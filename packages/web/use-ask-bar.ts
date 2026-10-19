// web/use-ask-bar — the shell of `ask-bar.ts`: measure each ask's work
// and message against the top of a column's view, on scroll and resize.

import { type EntryId, entryId } from "@pinetrie/core"
import {
  type AtTop,
  askAtTop,
  sameAtTop,
  type WorkBox,
} from "@pinetrie/web-core"
import { type RefObject, useEffect, useRef, useState } from "react"

/**
 * Which ask the work at the top of `body` belongs to, while `on`. Measured
 * once a frame at most, from `.ask-work[data-ask-of]` boxes (one per ask on
 * the path) and their messages, so a long thread measures few elements.
 */
export function useAskBar(
  body: RefObject<HTMLElement | null>,
  on: boolean,
): AtTop | null {
  const [atTop, setAtTop] = useState<AtTop | null>(null)
  const shown = useRef<AtTop | null>(null)
  useEffect(() => {
    const el = body.current
    if (el === null || !on) {
      shown.current = null
      setAtTop(null)
      return
    }
    let frame = 0
    const measure = () => {
      frame = 0
      const top = el.getBoundingClientRect().top
      const works: WorkBox[] = []
      const prompts = new Map<EntryId, number>()
      for (const w of el.querySelectorAll<HTMLElement>(
        ".ask-work[data-ask-of]",
      )) {
        // The ask id `ask-work.tsx` drew into `data-ask-of`, read back.
        const drawn = w.dataset.askOf
        if (drawn === undefined) continue
        const ask = entryId(drawn)
        const box = w.getBoundingClientRect()
        works.push({ ask, top: box.top - top, bottom: box.bottom - top })
        const prompt = el.querySelector(`.msg[data-entry="${ask}"]`)
        if (prompt !== null)
          prompts.set(ask, prompt.getBoundingClientRect().top - top)
      }
      const next = askAtTop(works, prompts)
      if (sameAtTop(next, shown.current)) return
      shown.current = next
      setAtTop(next)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    schedule()
    el.addEventListener("scroll", schedule, { passive: true })
    const resized = new ResizeObserver(schedule)
    resized.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener("scroll", schedule)
      resized.disconnect()
    }
  }, [body, on])
  return atTop
}
