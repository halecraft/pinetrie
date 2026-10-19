// web/use-viewport — the shell of `viewport.ts` for a column: measure which
// messages are in its view, once a frame at most, and tell the rail.

import {
  type Box,
  type Span,
  sameSpan,
  type ViewportStore,
  visibleSpan,
} from "@pinetrie/web-core"
import { type RefObject, useEffect, useMemo, useRef } from "react"

/**
 * Measure `body`'s messages (`.msg[data-entry]`, in path order) against its
 * view on scroll and resize, as `useAskBar` does, and write the span to
 * `store` under `key` with the messages between its edges, out of `ids`, the
 * column's messages in order. Returns the latest span, which a column leaving
 * keeps as its spot.
 */
export function useViewport(
  body: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  p: {
    readonly key: string
    readonly track: number
    readonly ids: readonly string[]
    readonly store: ViewportStore
  },
): RefObject<Span | null> {
  const span = useRef<Span | null>(null)
  const { key, track, ids, store } = p
  const at = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids])
  useEffect(() => {
    const el = body.current
    if (el === null) return
    let frame = 0
    let told: Span | null = null
    const measure = () => {
      frame = 0
      const top = el.getBoundingClientRect().top
      const boxes: Box[] = []
      for (const m of el.querySelectorAll<HTMLElement>(".msg[data-entry]")) {
        const id = m.dataset.entry
        if (id === undefined) continue
        const r = m.getBoundingClientRect()
        boxes.push({ id, top: r.top - top, bottom: r.bottom - top })
      }
      const next = visibleSpan(boxes, el.clientHeight)
      span.current = next
      if (sameSpan(next, told)) return
      told = next
      if (next === null) return store.set(key, null)
      const from = at.get(next.first.id)
      const to = at.get(next.last.id)
      if (from === undefined || to === undefined) return
      store.set(key, {
        track,
        ids: ids.slice(from, to + 1),
        first: next.first.at,
        last: next.last.at,
      })
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    schedule()
    el.addEventListener("scroll", schedule, { passive: true })
    const resized = new ResizeObserver(schedule)
    resized.observe(el)
    if (content.current !== null) resized.observe(content.current)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener("scroll", schedule)
      resized.disconnect()
    }
  }, [body, content, key, track, ids, at, store])
  // Gone from the rail when the column is.
  useEffect(() => () => store.set(key, null), [store, key])
  return span
}
