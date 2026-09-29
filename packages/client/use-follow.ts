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

/** The DOM event `alignOnOpen` and `useReveal` dispatch on a column body they have placed. */
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
 * With `hold`, while `holding`, a shrink is taken up by `floor`, an element
 * after `content` inside the scroller.
 */
export function useFollow(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  hold?: {
    readonly floor: RefObject<HTMLElement | null>
    readonly holding: boolean
  },
): Follow {
  // A ref: it changes every frame while a reply streams. Only `unseen` is
  // drawn, so only it is React state.
  const state = useRef(initialFollow)
  const [unseen, setUnseen] = useState(false)

  const floorRef = hold?.floor
  const step = useCallback(
    (
      event:
        | { readonly kind: Exclude<FollowEvent["kind"], "holding"> }
        | { readonly kind: "holding"; readonly value: boolean },
    ) => {
      const el = scroller.current
      if (el === null) return
      const floor = floorRef?.current ?? null
      const at = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        content: content.current?.offsetHeight ?? el.scrollHeight,
        floor: floor?.offsetHeight ?? 0,
      }
      const plan = follow(state.current, { ...event, at })
      state.current = plan.state
      // The floor first: a scroll to the end must see the height it makes.
      if (floor !== null && plan.floor !== at.floor)
        floor.style.height = `${plan.floor}px`
      // Always instant: a smooth scroll passes through positions short of the
      // end, and each would read as the reader leaving.
      if (plan.scrollTo !== null) el.scrollTop = plan.scrollTo
      setUnseen(plan.state.unseen)
    },
    [scroller, content, floorRef],
  )

  const holding = hold?.holding ?? false
  useLayoutEffect(() => {
    if (holding !== state.current.holding)
      step({ kind: "holding", value: holding })
  }, [holding, step])

  useLayoutEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (el === null || inner === null) return
    const resized = new ResizeObserver(() => step({ kind: "resized" }))
    resized.observe(el)
    resized.observe(inner)
    const scrolled = () => step({ kind: "scrolled" })
    const placed = () => step({ kind: "placed" })
    el.addEventListener("scroll", scrolled, { passive: true })
    el.addEventListener(PLACED, placed)
    return () => {
      resized.disconnect()
      el.removeEventListener("scroll", scrolled)
      el.removeEventListener(PLACED, placed)
    }
  }, [scroller, content, step])

  return {
    unseen,
    follow: useCallback(() => step({ kind: "follow" }), [step]),
  }
}
