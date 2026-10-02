// client/use-follow — the shell of `follow.ts`: read the scroller, decide,
// scroll.

import type { EntryId } from "@pineta/core"
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  type FollowEvent,
  type FollowState,
  follow,
  initialFollow,
} from "./follow.ts"

/** The DOM event `alignOnOpen` and `useReveal` dispatch on a column body they have placed. */
export const PLACED = "pineta:placed"

export interface Follow {
  /** Released, and content has arrived below since, or it was mounted behind. */
  readonly unseen: boolean
  /** The column's tip when its reader left its end; null while following. */
  readonly releasedTip: EntryId | null
  /** Jump to the end, and follow it again. */
  readonly follow: () => void
}

/**
 * Keep `scroller` at its end while the reader is there (`follow.ts`).
 * `content` is the element whose height grows; a ResizeObserver watches it and
 * the scroller's viewport, and follows in the frame the layout changed.
 * With `hold`, while `holding`, a shrink is taken up by `floor`, an element
 * after `content` inside the scroller.
 * With `seen`, it starts with ↓ new below showing when `seen.unseen` (read
 * at mount only), and tells `seen.leave` whether it was showing, and the
 * tip it was released from: on unmount, and when the page is hidden, since
 * most context switches leave the browser, not the tab (ADR-0056).
 * The first placement keeps it only short of the end: nothing clears it
 * before then, since a scroller's first resize comes after `alignOnOpen`.
 * `tip` is the column's tip now, which a release keeps (`releasedTip`).
 */
export function useFollow(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  hold?: {
    readonly floor: RefObject<HTMLElement | null>
    readonly holding: boolean
  },
  seen?: {
    readonly unseen: boolean
    /** The tip it was released from when it was last unmounted. */
    readonly released: EntryId | null
    readonly leave: (left: {
      readonly unseen: boolean
      readonly released: EntryId | null
      readonly following: boolean
    }) => void
  },
  tip: EntryId | null = null,
): Follow {
  // A ref: it changes every frame while a reply streams. Only `unseen` and
  // `releasedTip` are drawn, so only they are React state.
  const state = useRef<FollowState>({
    ...initialFollow,
    unseen: seen?.unseen ?? false,
    releasedTip: seen?.released ?? null,
  })
  const [unseen, setUnseen] = useState(state.current.unseen)
  const [releasedTip, setReleasedTip] = useState(state.current.releasedTip)
  const tipNow = useRef(tip)
  tipNow.current = tip
  const leave = seen?.leave
  useLayoutEffect(() => {
    const left = () =>
      leave?.({
        unseen: state.current.unseen,
        released: state.current.releasedTip,
        following: state.current.following,
      })
    const hidden = () => {
      if (document.visibilityState === "hidden") left()
    }
    document.addEventListener("visibilitychange", hidden)
    window.addEventListener("pagehide", left)
    return () => {
      document.removeEventListener("visibilitychange", hidden)
      window.removeEventListener("pagehide", left)
      left()
    }
  }, [leave])

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
        tip: tipNow.current,
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
      setReleasedTip(plan.state.releasedTip)
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
    releasedTip,
    follow: useCallback(() => step({ kind: "follow" }), [step]),
  }
}
