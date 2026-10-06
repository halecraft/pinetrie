// web/use-root-drag — a root's drag, from the board or your list
// (ADR-0085).
//
// The shell of `root-target.ts`: a drop lands only where a key could move it
// (`planRootDrop`), at the place in a group the pointer is nearest
// (`landingIn`).
// While a root is dragged, the zone it would land on carries
// `data-root-drop`, which draws a line where it goes, and the item dragged
// carries `data-root-dragging`, which dims it. Both are written to the DOM,
// never to React state, as a column's drag is (`use-column-drag.ts`).

import type { WorkflowStateId } from "@pinetrie/core"
import {
  encodeRootDrag,
  type Intent,
  landingIn,
  parseRootDrag,
  placeAfter,
  planRootDrop,
  ROOT_DROP_ZONE,
  ROOT_GROUP_ZONE,
  ROOT_MIME,
  type RootDrag,
  type RootTarget,
  rootTargetOfElement,
} from "@pinetrie/interface"
import { type DragEvent as ReactDragEvent, useEffect } from "react"

/** An item a root is dragged from: a board card or a row of your list. */
const ROOT_ITEM = ".board-item, .open-item"

/**
 * A root's drag start, from the board or your list: it carries `drag` (none
 * while the root has no id), and its image is the whole item, held where the
 * pointer took it.
 */
export const startRootDrag =
  (drag: RootDrag | null) => (e: ReactDragEvent<HTMLElement>) => {
    if (drag === null || e.dataTransfer === null) return
    e.dataTransfer.setData(ROOT_MIME, encodeRootDrag(drag))
    e.dataTransfer.effectAllowed = "move"
    const item = e.currentTarget.closest(ROOT_ITEM)
    if (item === null) return
    const box = item.getBoundingClientRect()
    e.dataTransfer.setDragImage(item, e.clientX - box.left, e.clientY - box.top)
  }

/** A group's places: its items, in order, and its end. */
function placesOf(group: Element | null): {
  readonly items: readonly HTMLElement[]
  readonly end: HTMLElement
} | null {
  if (group === null) return null
  const zones = [group, ...group.querySelectorAll(ROOT_DROP_ZONE)].filter(
    (z): z is HTMLElement =>
      z instanceof HTMLElement && z.matches(ROOT_DROP_ZONE),
  )
  const before = (z: HTMLElement) => rootTargetOfElement(z)?.before
  const end = zones.find(z => before(z) === null)
  if (end === undefined) return null
  return { items: zones.filter(z => before(z) != null), end }
}

/** Where a drag event over the page would land: the zone, and its target. */
function landingAt(
  e: DragEvent,
): { readonly el: HTMLElement; readonly target: RootTarget } | null {
  const places = placesOf(
    e.target instanceof Element ? e.target.closest(ROOT_GROUP_ZONE) : null,
  )
  if (places === null) return null
  const el = landingIn(
    places.items.map(zone => {
      const box = zone.getBoundingClientRect()
      return { zone, mid: box.top + box.height / 2 }
    }),
    places.end,
    e.clientY,
  )
  const target = rootTargetOfElement(el)
  return target === null ? null : { el, target }
}

export function useRootDrag(
  onIntent: (intent: Intent) => void,
  closed: WorkflowStateId | null,
): void {
  useEffect(() => {
    // A drag begun in this page: what it carries, its item, and the place
    // just after it, where a drop moves nothing.
    let from: {
      readonly drag: RootDrag
      readonly item: HTMLElement | null
      readonly home: RootTarget | null
    } | null = null
    let dim: ReturnType<typeof setTimeout> | undefined
    let marked: HTMLElement | null = null
    const mark = (el: HTMLElement | null) => {
      if (el === marked) return
      if (marked !== null) delete marked.dataset.rootDrop
      if (el !== null) el.dataset.rootDrop = ""
      marked = el
    }
    const finish = () => {
      clearTimeout(dim)
      mark(null)
      if (from?.item != null) delete from.item.dataset.rootDragging
      from = null
    }
    const carriesRoot = (e: DragEvent) =>
      e.dataTransfer?.types.includes(ROOT_MIME) === true
    const onStart = (e: DragEvent) => {
      if (!carriesRoot(e)) return
      finish()
      const drag = parseRootDrag(e.dataTransfer?.getData(ROOT_MIME) ?? "")
      if (drag === null) return
      const item =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>(ROOT_ITEM)
          : null
      const places = placesOf(item?.closest(ROOT_GROUP_ZONE) ?? null)
      from = {
        drag,
        item,
        home:
          item === null || places === null
            ? null
            : rootTargetOfElement(placeAfter(places.items, item, places.end)),
      }
      // Dimmed after the browser has drawn the drag's image from it.
      dim = setTimeout(() => {
        if (item !== null) item.dataset.rootDragging = ""
      })
    }
    const onOver = (e: DragEvent) => {
      if (!carriesRoot(e)) return
      const landing = closed === null ? null : landingAt(e)
      if (closed === null || landing === null) return mark(null)
      e.preventDefault()
      const moves =
        from === null ||
        planRootDrop(from.drag, landing.target, closed, from.home) !== null
      mark(moves ? landing.el : null)
    }
    // Off the page: no line is left behind.
    const onLeave = (e: DragEvent) => {
      if (carriesRoot(e) && e.relatedTarget === null) mark(null)
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesRoot(e) || closed === null) return
      const home = from?.home ?? null
      finish()
      const landing = landingAt(e)
      const drag = parseRootDrag(e.dataTransfer?.getData(ROOT_MIME) ?? "")
      if (landing === null || drag === null) return
      e.preventDefault()
      const intent = planRootDrop(drag, landing.target, closed, home)
      if (intent !== null) onIntent(intent)
    }
    document.addEventListener("dragstart", onStart)
    document.addEventListener("dragover", onOver)
    document.addEventListener("dragleave", onLeave)
    document.addEventListener("dragend", finish)
    document.addEventListener("drop", onDrop)
    return () => {
      finish()
      document.removeEventListener("dragstart", onStart)
      document.removeEventListener("dragover", onOver)
      document.removeEventListener("dragleave", onLeave)
      document.removeEventListener("dragend", finish)
      document.removeEventListener("drop", onDrop)
    }
  }, [onIntent, closed])
}
