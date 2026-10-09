// web/use-column-drag — move a column by dragging its header along the strip.
//
// The shell of `reorder.ts`. Only a card's column moves (`data-card`): a
// branch not yet sent has no place on the canvas until its first send, and
// the task column stands before every card. Dropped, the column's card is
// reordered on the canvas, for everyone (ADR-0116). A drag writes to the DOM
// directly (a transform, `data-dragging`, `data-drop`), never to React
// state: a render of `App` per pointer move would redraw every column. The
// order changes once, on drop: moving a column changes what the columns
// right of it show (`projectColumns`), and columns redrawn under the pointer
// would be hard to aim between.

import { edgeScroll, gapAt, landing } from "@pinetrie/interface"
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react"

/** Where a press in a header starts no drag: its controls, and a card's own drag. */
const NOT_A_HANDLE =
  "button:not(.grip), a, input, textarea, select, summary, [role='menu'], [draggable='true']"

/** How far, in px, a press moves before it is a drag rather than a click. */
export const DRAG_START = 5

/** A column a drag moves: one with a card on the canvas. */
const CARD_COLUMN = ":scope > [data-card]"

/**
 * The strip's pointerdown handler. `move(card, to)` is called once per drop
 * that moves a column, `to` its index among the card columns; Escape or a
 * cancelled pointer moves nothing.
 */
export function useColumnDrag(
  strip: RefObject<HTMLDivElement | null>,
  move: (card: string, to: number) => void,
): (e: ReactPointerEvent<HTMLDivElement>) => void {
  // A drag in flight, stopped if the strip unmounts under it.
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  return e => {
    const el = strip.current
    const target = e.target
    if (el === null || e.button !== 0 || !(target instanceof Element)) return
    const head = target.closest("[data-column-head]")
    if (head === null || target.closest(NOT_A_HANDLE) !== null) return
    const columns = [...el.querySelectorAll<HTMLElement>(CARD_COLUMN)]
    const column = head.closest<HTMLElement>("[data-card]")
    const from = column === null ? -1 : columns.indexOf(column)
    const card = column?.dataset.card
    if (column === null || card === undefined || from < 0 || columns.length < 2)
      return
    stop.current?.()

    const pointer = e.pointerId
    const start = { x: e.clientX, y: e.clientY, scroll: el.scrollLeft }
    let x = e.clientX
    // Set once the press has moved far enough to be a drag.
    let drag: {
      /** Each column's centre, in the strip's content coordinates. */
      readonly mids: readonly number[]
      /** How far the column may slide either way: to the strip's ends, no further. */
      readonly min: number
      readonly max: number
    } | null = null
    let gap = from
    let frame = 0

    const contentX = (clientX: number, box: DOMRect) =>
      clientX - box.left + el.scrollLeft

    const update = () => {
      if (drag === null) return
      const box = el.getBoundingClientRect()
      gap = gapAt(drag.mids, contentX(x, box))
      // Clamped, so the column never widens the strip it scrolls: the edge
      // scroll would chase it for ever.
      const dx = Math.min(
        Math.max(x - start.x + el.scrollLeft - start.scroll, drag.min),
        drag.max,
      )
      column.style.transform = `translateX(${dx}px)`
      for (const c of columns) delete c.dataset.drop
      if (landing(from, gap) === null) return
      const before = columns[gap]
      const last = columns.at(-1)
      if (before !== undefined) before.dataset.drop = "before"
      else if (last !== undefined) last.dataset.drop = "after"
    }

    const tick = () => {
      const box = el.getBoundingClientRect()
      const by = edgeScroll(x, box.left, box.right)
      if (by !== 0) {
        el.scrollLeft += by
        update()
      }
      frame = requestAnimationFrame(tick)
    }

    const begin = () => {
      const box = el.getBoundingClientRect()
      const own = column.getBoundingClientRect()
      const left = contentX(own.left, box)
      drag = {
        mids: columns.map(c => {
          const r = c.getBoundingClientRect()
          return contentX(r.left, box) + r.width / 2
        }),
        min: -left,
        max: el.scrollWidth - (left + own.width),
      }
      column.dataset.dragging = ""
      el.dataset.reordering = ""
      getSelection()?.removeAllRanges()
      head.setPointerCapture(pointer)
      frame = requestAnimationFrame(tick)
    }

    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== pointer) return
      x = m.clientX
      if (drag === null) {
        if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_START)
          return
        begin()
      }
      update()
    }

    const finish = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("keydown", onKey)
      column.style.transform = ""
      delete column.dataset.dragging
      for (const c of columns) delete c.dataset.drop
      delete el.dataset.reordering
      stop.current = null
    }
    const onUp = (u: PointerEvent) => {
      if (u.pointerId !== pointer) return
      const to = drag === null ? null : landing(from, gap)
      finish()
      if (to !== null) move(card, to)
    }
    const onCancel = (c: PointerEvent) => {
      if (c.pointerId === pointer) finish()
    }
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || drag === null) return
      k.preventDefault()
      finish()
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("keydown", onKey)
    stop.current = finish
  }
}
