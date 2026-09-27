// client/use-follow — the shell of `follow.ts`: read the scroller, decide,
// scroll.

import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { type FollowEvent, follow, initialFollow } from "./follow.ts"

/** The DOM event `alignOnOpen` dispatches on a column body it has placed. */
export const PLACED = "pineta:placed"

export interface Follow {
  /** Released, and content has arrived below since. */
  readonly unseen: boolean
  /** Jump to the end, and follow it again. */
  readonly follow: () => void
}

/**
 * Keep `scroller` at its end while the reader is there (`follow.ts`).
 * `content` is the element whose height grows; a ResizeObserver watches it and
 * the scroller's viewport, and follows in the frame the layout changed.
 */
export function useFollow(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): Follow {
  // A ref: it changes every frame while a reply streams. Only `unseen` is
  // drawn, so only it is React state.
  const state = useRef(initialFollow)
  const [unseen, setUnseen] = useState(false)

  const step = useCallback(
    (kind: FollowEvent["kind"]) => {
      const el = scroller.current
      if (el === null) return
      const at = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }
      const plan = follow(state.current, { kind, at })
      state.current = plan.state
      // Always instant: a smooth scroll passes through positions short of the
      // end, and each would read as the reader leaving.
      if (plan.scrollTo !== null) el.scrollTop = plan.scrollTo
      setUnseen(plan.state.unseen)
    },
    [scroller],
  )

  useLayoutEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (el === null || inner === null) return
    const resized = new ResizeObserver(() => step("resized"))
    resized.observe(el)
    resized.observe(inner)
    const scrolled = () => step("scrolled")
    const placed = () => step("placed")
    el.addEventListener("scroll", scrolled, { passive: true })
    el.addEventListener(PLACED, placed)
    return () => {
      resized.disconnect()
      el.removeEventListener("scroll", scrolled)
      el.removeEventListener(PLACED, placed)
    }
  }, [scroller, content, step])

  return { unseen, follow: useCallback(() => step("follow"), [step]) }
}
