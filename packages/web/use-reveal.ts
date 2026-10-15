// web/use-reveal — bring a picked message into view, and keep it there; and
// outline where leaving a search landed.

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react"
import { PLACED } from "./use-follow.ts"

/**
 * Centre `.msg[data-entry=id]` in its column unless it is already in view, then
 * tell the column it was placed. Without `PLACED`, a column that has just
 * opened is still following: scrolled down from 0, it has not moved up, so it
 * would jump to its end on its next resize. False when the message is not
 * drawn.
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
 * Scroll a queued card into view in its column's dock, which scrolls apart from
 * the thread. False when the card is not drawn.
 */
function showCard(container: HTMLElement, card: string): boolean {
  const frame = container.querySelector(`.dock [data-queued="${card}"]`)
  if (frame === null) return false
  frame.scrollIntoView({ block: "nearest" })
  return true
}

/**
 * Do `act` to the element `id` names in `container`: now, if `act` finds it
 * drawn, or after each render until it does. A newer call replaces one still
 * waiting. With `afterRender`, it waits for the render the call causes even
 * when the element is drawn.
 *
 * Call each hook over it after any layout effect that places columns: layout
 * effects run in the order they are declared, so `act` comes last.
 */
function useWhenDrawn(
  container: RefObject<HTMLElement | null>,
  act: (container: HTMLElement, id: string) => boolean,
): (id: string, afterRender?: boolean) => void {
  const pending = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = pending.current
    const el = container.current
    if (id === null || el === null) return
    if (act(el, id)) pending.current = null
  })
  return useCallback(
    (id: string, afterRender = false) => {
      const el = container.current
      pending.current = !afterRender && el !== null && act(el, id) ? null : id
    },
    [container, act],
  )
}

/**
 * Bring entry `id` into view in `container`: now, if it is drawn, or once it
 * is. Picking a message a column already draws changes no state, so no render
 * follows; a message in a column that is opening, or in another root, is drawn
 * by the render the pick causes. With `afterRender`, it waits for the render a
 * pick causes even when the message is drawn: a fold opening above it moves it
 * (an ask's last word is drawn while its fold is closed).
 */
export const useReveal = (container: RefObject<HTMLElement | null>) =>
  useWhenDrawn(container, show)

/** Set `data-landed` on `.msg[data-entry=id]` until its animation ends. False when it is not drawn. */
function land(container: HTMLElement, id: string): boolean {
  const message = container.querySelector<HTMLElement>(
    `.msg[data-entry="${id}"]`,
  )
  if (message === null) return false
  message.dataset.landed = ""
  message.addEventListener(
    "animationend",
    () => {
      delete message.dataset.landed
    },
    { once: true },
  )
  return true
}

/**
 * Outline entry `id` in `container`, where leaving a search landed: now, if
 * it is drawn, or once it is. CSS draws and fades the outline
 * (`.msg[data-landed]`).
 */
export const useLanding = (container: RefObject<HTMLElement | null>) =>
  useWhenDrawn(container, land)

/** Bring the queued card `card` into view in its dock: now, if it is drawn, or once it is. */
export const useRevealCard = (container: RefObject<HTMLElement | null>) =>
  useWhenDrawn(container, showCard)
