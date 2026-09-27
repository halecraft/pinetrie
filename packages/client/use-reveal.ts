// client/use-reveal — bring a picked message into view, and keep it there.

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react"
import { PLACED } from "./use-follow.ts"

/**
 * Centre `.msg[data-entry=id]` in its column unless it is already in view,
 * then tell the column it was placed. Without `PLACED`, a column that has just
 * opened is still following: scrolled down from 0, it has not moved up, so it
 * would jump to its end on its next resize (S33). False when the message is
 * not drawn.
 */
function show(container: HTMLElement, id: string): boolean {
  const message = container.querySelector(`.msg[data-entry="${id}"]`)
  if (message === null) return false
  const body = message.closest(".column-body")
  if (body === null) return false
  // A branch opened from its fork point is already level with it, which
  // says more than the centre would.
  const m = message.getBoundingClientRect()
  const view = body.getBoundingClientRect()
  if (m.top < view.top || m.bottom > view.bottom)
    // Instant, as every scroll of a followed column must be (`use-follow.ts`).
    message.scrollIntoView({ block: "center" })
  body.dispatchEvent(new Event(PLACED))
  return true
}

/**
 * Bring entry `id` into view in `container`: now, if it is drawn, or once it
 * is. Picking a message a column on this tab already draws changes no state,
 * so no render follows (S33); a message in a column that is opening, or in
 * another tab, is drawn by the render the pick causes. A newer pick replaces
 * one still waiting.
 *
 * Call it after any layout effect that places columns: layout effects run in
 * the order they are declared, so the pick's scroll comes last.
 */
export function useReveal(
  container: RefObject<HTMLElement | null>,
): (id: string) => void {
  const pending = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = pending.current
    const el = container.current
    if (id === null || el === null) return
    if (show(el, id)) pending.current = null
  })
  return useCallback(
    (id: string) => {
      const el = container.current
      pending.current = el !== null && show(el, id) ? null : id
    },
    [container],
  )
}
