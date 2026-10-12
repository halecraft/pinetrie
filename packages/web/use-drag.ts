// web/use-drag — the one drag engine: every drag that starts in the page,
// a column's, a card's, a slot's, a task's, by the pointer. It decides
// nothing (`drag.ts` in `@pinetrie/interface` does): each frame it gathers
// the pointer and the element under it, asks `dragVerdict` and `drawPlan`,
// and applies the plan to `style` and `dataset`; a drop sends
// `dropIntents`. A drag writes to the DOM, never to React state: a render of
// `App` per pointer move would redraw every column.
//
// What the first frame needs is measured at the press, before the drag
// threshold, so the one long frame of a drag falls before anything is seen
// to move. Touch does not drag: a touch scrolls and taps.

import { isTaskId, type TaskId, type WorkflowStateId } from "@pinetrie/core"
import {
  type Armed,
  DRAG_HANDLE,
  DRAG_START,
  DROP_ZONE,
  type DragFrom,
  type DragOver,
  type DragSource,
  type DragVerdict,
  dragVerdict,
  drawPlan,
  dropIntents,
  edgeScroll,
  gapAt,
  type HoverOver,
  hoverOpens,
  type Intent,
  type IntentState,
  ITEM_HOVER_MS,
  landingIn,
  NOT_A_HANDLE,
  type PutHow,
  placeAfter,
  ROOT_DROP_ZONE,
  ROOT_GROUP_ZONE,
  type RootTarget,
  rootTargetOfElement,
  sidebarSpotAt,
  sourceOfElement,
  targetOfElement,
} from "@pinetrie/interface"
import { type RefObject, useEffect } from "react"
import { useStable } from "./use-stable.ts"

/** How long a cancelled drag springs back, in ms: none with reduced motion. */
const settleMs = (): number =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160

/** What a task is dragged from: a board card or a row of the sidebar. */
const ROOT_ITEM = ".thread-card, .sidebar-item"

/** What moves with a card's handle: its frame, its slot. */
const CARD_ITEM = ".card-frame, .card-grid-cell"

/** A group's places for a task's drop: its items, in order, and its end. */
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

/** Where a task's drop at `y` lands in the group under the pointer: its zone, and its target. */
function rootLanding(
  under: Element | null,
  y: number,
): { readonly el: HTMLElement; readonly target: RootTarget } | null {
  const places = placesOf(under?.closest(ROOT_GROUP_ZONE) ?? null)
  if (places === null) return null
  const el = landingIn(
    places.items.map(zone => {
      const box = zone.getBoundingClientRect()
      return { zone, mid: box.top + box.height / 2 }
    }),
    places.end,
    y,
  )
  const target = rootTargetOfElement(el)
  return target === null ? null : { el, target }
}

/** The task of the sidebar's row after `row`, among its rows; null at the end. */
function nextRowTask(row: HTMLElement): TaskId | null {
  const rows = [
    ...(row.parentElement?.querySelectorAll<HTMLElement>(
      ":scope > [data-put-sidebar]",
    ) ?? []),
  ]
  const next = rows[rows.indexOf(row) + 1]
  return next === undefined ? null : taskOf(next.dataset.putSidebar)
}

const taskOf = (id: string | undefined): TaskId | null =>
  id !== undefined && isTaskId(id) ? id : null

/** Set a style property only when it changes. */
const write = (
  el: HTMLElement,
  prop: "transform" | "opacity",
  value: string,
) => {
  if (el.style[prop] !== value) el.style[prop] = value
}

/** What the press armed: the source, what moves, and what the first frame needs. */
interface Press {
  readonly source: DragSource
  readonly handle: HTMLElement
  readonly moving: HTMLElement
  readonly pointer: number
  readonly armed: Armed
  readonly from: DragFrom
  /** The strip's card columns, in order, for a column's drag. */
  readonly columns: readonly HTMLElement[]
  /** Each column's centre, in the strip's content coordinates. */
  readonly mids: readonly number[]
  readonly strip: HTMLElement | null
  /** The card face drawn off the strip, a copy of the handle; null for no column. */
  readonly face: HTMLElement | null
}

export function useDrag(input: {
  readonly strip: RefObject<HTMLElement | null>
  /** The intent state now: read each frame, never rebuilt for it. */
  readonly state: () => IntentState
  readonly archive: WorkflowStateId | null
  readonly onIntent: (intent: Intent) => void
}): void {
  const send = useStable(input.onIntent)
  const read = useStable(input.state)
  const archive = useStable(() => input.archive)
  const { strip: stripRef } = input

  useEffect(() => {
    let press: Press | null = null
    let begun = false
    let x = 0
    let y = 0
    let lastX = 0
    let speed = 0
    let alt = false
    let frame = 0
    let over: DragOver = { kind: "none" }
    let verdict: DragVerdict = { kind: "nothing" }
    let marked: HTMLElement | null = null
    let hover: { readonly key: string; readonly timer: number } | null = null
    let hovered: HTMLElement | null = null
    let swallowClick = false

    const how = (): PutHow => (alt ? "copy" : "move")

    const mark = (el: HTMLElement | null, value: string | null) => {
      if (marked !== null && marked !== el) {
        delete marked.dataset.dragVerdict
        delete marked.dataset.rootDrop
      }
      marked = el
      if (el === null || value === null) {
        if (el !== null) {
          delete el.dataset.dragVerdict
          delete el.dataset.rootDrop
        }
        return
      }
      if (press?.source.kind === "task") el.dataset.rootDrop = ""
      else el.dataset.dragVerdict = value
    }

    const setHover = (at: HoverOver, el: HTMLElement | null) => {
      const key =
        at.kind === "task" ? at.task : at.kind === "board" ? "board" : ""
      if (hover?.key === key) return
      if (hover !== null) window.clearTimeout(hover.timer)
      if (hovered !== null) delete hovered.dataset.hoverOpen
      hover = null
      hovered = null
      const opens = hoverOpens(at)
      if (opens === null || el === null) return
      el.dataset.hoverOpen = ""
      hovered = el
      hover = {
        key,
        timer: window.setTimeout(() => {
          if (hovered !== null) delete hovered.dataset.hoverOpen
          send(opens)
        }, ITEM_HOVER_MS),
      }
    }

    /** What is under the pointer now, read from the page. */
    const gather = (p: Press): { over: DragOver; el: HTMLElement | null } => {
      const under = document.elementFromPoint(x, y)
      const row = under?.closest<HTMLElement>(".open-root[data-task]") ?? null
      const rowTask = taskOf(row?.dataset.task)
      const board = under?.closest<HTMLElement>(".board-toggle") ?? null
      setHover(
        board !== null
          ? { kind: "board" }
          : rowTask !== null
            ? { kind: "task", task: rowTask }
            : { kind: "none" },
        board ?? row,
      )
      if (p.source.kind === "task") {
        const lands = rootLanding(under, y)
        return lands === null
          ? { over: { kind: "none" }, el: null }
          : { over: { kind: "root", target: lands.target }, el: lands.el }
      }
      const { strip } = p
      if (p.armed.column && strip !== null && p.armed.strip !== null) {
        const box = p.armed.strip
        if (
          x >= box.left &&
          x <= box.right &&
          y >= box.top &&
          y <= box.bottom
        ) {
          const contentX = x - box.left + strip.scrollLeft
          return {
            over: { kind: "strip", gap: gapAt(p.mids, contentX) },
            el: null,
          }
        }
      }
      const zone = under?.closest<HTMLElement>(DROP_ZONE) ?? null
      const target = zone === null ? null : targetOfElement(zone)
      if (zone === null || target === null)
        return { over: { kind: "none" }, el: null }
      // A row of the sidebar: onto its task, or between it and a neighbour.
      if (target.kind === "sidebar" && target.before !== null) {
        const box = zone.getBoundingClientRect()
        return {
          over: {
            kind: "put",
            target: sidebarSpotAt(
              y,
              { top: box.top, height: box.height },
              target.before,
              nextRowTask(zone),
            ),
          },
          el: zone,
        }
      }
      return { over: { kind: "put", target }, el: zone }
    }

    const tick = () => {
      const p = press
      if (p === null || !begun) return
      const seen = gather(p)
      over = seen.over
      verdict = dragVerdict(p.source, p.from, over, how(), read())
      const plan = drawPlan(p.armed, { x, y }, speed, over, verdict, how())
      speed *= 0.6
      // Only what changed is written: a style written again, the same,
      // still costs the page a style pass over what it touches.
      // The dragged element translates, never more; hidden while its face
      // stands for it off the strip.
      write(
        p.moving,
        "transform",
        plan.dragged === null
          ? ""
          : `translate(${plan.dragged.x}px, ${plan.dragged.y}px)`,
      )
      write(p.moving, "opacity", plan.dragged === null ? "0" : "")
      if (p.face !== null) {
        if (p.face.hidden !== (plan.face === null))
          p.face.hidden = plan.face === null
        if (plan.face !== null)
          write(
            p.face,
            "transform",
            `translate(${plan.face.x}px, ${plan.face.y}px)`,
          )
      }
      plan.shifts.forEach((shift, i) => {
        const c = p.columns[i]
        if (c === undefined || c === p.moving) return
        write(c, "transform", shift === 0 ? "" : `translateX(${shift}px)`)
      })
      const lean = `${Math.round(plan.lean * 2) / 2}deg`
      if (p.handle.style.getPropertyValue("--lean") !== lean)
        p.handle.style.setProperty("--lean", lean)
      if (
        seen.el !== marked ||
        (seen.el?.dataset.dragVerdict ?? null) !== plan.mark
      )
        mark(seen.el, plan.mark)
      // The strip scrolls near its edges while a column is over it.
      if (p.strip !== null && over.kind === "strip" && p.armed.strip !== null) {
        const by = edgeScroll(x, p.armed.strip.left, p.armed.strip.right)
        if (by !== 0) p.strip.scrollLeft += by
      }
      frame = requestAnimationFrame(tick)
    }

    const begin = (p: Press) => {
      begun = true
      p.handle.setPointerCapture(p.pointer)
      p.moving.dataset.dragging = ""
      p.moving.style.pointerEvents = "none"
      if (p.source.kind === "card") document.body.dataset.cardDrag = ""
      if (p.armed.column && p.strip !== null) p.strip.dataset.reordering = ""
      getSelection()?.removeAllRanges()
      swallowClick = true
      frame = requestAnimationFrame(tick)
    }

    /** Clear what the drag drew; a cancel springs back, a drop settles. */
    const finish = (dropped: boolean) => {
      const p = press
      press = null
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onCancel, true)
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onKey, true)
      setHover({ kind: "none" }, null)
      mark(null, null)
      if (p === null) return
      const wasBegun = begun
      begun = false
      delete document.body.dataset.cardDrag
      if (p.strip !== null) delete p.strip.dataset.reordering
      delete p.moving.dataset.dragging
      p.moving.style.pointerEvents = ""
      p.moving.style.opacity = ""
      p.handle.style.removeProperty("--lean")
      const settle = (el: HTMLElement) => {
        el.style.transition = dropped
          ? ""
          : `transform ${settleMs()}ms ease-out`
        el.style.transform = ""
      }
      settle(p.moving)
      for (const c of p.columns) settle(c)
      p.face?.remove()
      window.setTimeout(() => {
        p.moving.style.transition = ""
        p.moving.style.willChange = ""
        for (const c of p.columns) c.style.transition = ""
      }, settleMs())
      // The click a release sends after a drag is the drag's, not a press.
      if (wasBegun) window.setTimeout(() => (swallowClick = false))
      else swallowClick = false
    }

    const onMove = (e: PointerEvent) => {
      const p = press
      if (p === null || e.pointerId !== p.pointer) return
      x = e.clientX
      y = e.clientY
      speed = 0.6 * speed + 0.4 * (x - lastX)
      lastX = x
      alt = e.altKey
      if (!begun) {
        const moved = Math.hypot(x - p.armed.start.x, y - p.armed.start.y)
        if (moved >= DRAG_START) begin(p)
      }
    }

    const onUp = (e: PointerEvent) => {
      const p = press
      if (p === null || e.pointerId !== p.pointer) return
      if (!begun) return finish(false)
      const seen = gather(p)
      const final = dragVerdict(p.source, p.from, seen.over, how(), read())
      const intents = dropIntents(p.source, seen.over, final, how())
      finish(intents.length > 0)
      for (const intent of intents) send(intent)
    }

    const onCancel = (e: PointerEvent) => {
      if (press !== null && e.pointerId === press.pointer) finish(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (press === null) return
      if (e.key === "Alt") alt = e.type === "keydown"
      if (e.type === "keydown" && e.key === "Escape" && begun) {
        e.preventDefault()
        finish(false)
      }
    }

    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return
      e.preventDefault()
      e.stopPropagation()
      swallowClick = false
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return
      const target = e.target instanceof Element ? e.target : null
      if (target === null || target.closest(NOT_A_HANDLE) !== null) return
      const handle = target.closest<HTMLElement>(DRAG_HANDLE)
      const source = handle === null ? null : sourceOfElement(handle)
      if (handle === null || source === null) return
      if (press !== null) finish(false)
      press = arm(handle, source, e)
      x = e.clientX
      y = e.clientY
      lastX = x
      speed = 0
      alt = e.altKey
      window.addEventListener("pointermove", onMove, true)
      window.addEventListener("pointerup", onUp, true)
      window.addEventListener("pointercancel", onCancel, true)
      window.addEventListener("keydown", onKey, true)
      window.addEventListener("keyup", onKey, true)
    }

    /** Measure, at the press, what the first frame needs. */
    const arm = (
      handle: HTMLElement,
      source: DragSource,
      e: PointerEvent,
    ): Press => {
      const strip = stripRef.current
      const column =
        source.kind === "card"
          ? (handle.closest<HTMLElement>("#strip > [data-card]") ?? null)
          : null
      const columns =
        column !== null && strip !== null
          ? [...strip.querySelectorAll<HTMLElement>(":scope > [data-card]")]
          : []
      const stripBox = strip?.getBoundingClientRect() ?? null
      const gap =
        strip === null
          ? 0
          : Number.parseFloat(getComputedStyle(strip).columnGap) || 0
      // A cancel's spring back may still be running: measure where each
      // column is, not where it is drawn on its way back.
      for (const c of columns) {
        c.style.transition = "none"
        c.style.transform = ""
      }
      const boxes = columns.map(c => c.getBoundingClientRect())
      const at = column === null ? -1 : columns.indexOf(column)
      const moving =
        column ??
        (source.kind === "task"
          ? handle.closest<HTMLElement>(ROOT_ITEM)
          : handle.closest<HTMLElement>(CARD_ITEM)) ??
        handle
      for (const c of columns)
        c.style.transition = `transform ${settleMs()}ms ease-out`
      moving.style.transition = "none"
      moving.style.willChange = "transform"
      // A column's card face: its header, copied, drawn off the strip.
      let face: HTMLElement | null = null
      if (column !== null) {
        face = document.createElement("div")
        face.className = "drag-face"
        face.hidden = true
        face.append(handle.cloneNode(true))
        document.body.append(face)
      }
      const item =
        source.kind === "task" ? handle.closest<HTMLElement>(ROOT_ITEM) : null
      const places = placesOf(item?.closest(ROOT_GROUP_ZONE) ?? null)
      return {
        source,
        handle,
        moving,
        pointer: e.pointerId,
        columns,
        strip: column === null ? null : strip,
        face,
        mids:
          stripBox === null || strip === null
            ? []
            : boxes.map(
                b => b.left - stripBox.left + strip.scrollLeft + b.width / 2,
              ),
        armed: {
          start: { x: e.clientX, y: e.clientY },
          column: column !== null,
          strip:
            column === null || stripBox === null
              ? null
              : {
                  left: stripBox.left,
                  right: stripBox.right,
                  top: stripBox.top,
                  bottom: stripBox.bottom,
                },
          from: at < 0 ? null : at,
          widths: boxes.map(b => b.width + gap),
        },
        from: {
          column: at < 0 ? null : at,
          home:
            item === null || places === null
              ? null
              : rootTargetOfElement(placeAfter(places.items, item, places.end)),
          archive: archive(),
        },
      }
    }

    // The browser's own drag of a link or an image inside a handle would
    // take the pointer from this one.
    const onNativeStart = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(DRAG_HANDLE) !== null)
        e.preventDefault()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("click", onClick, true)
    document.addEventListener("dragstart", onNativeStart, true)
    return () => {
      finish(false)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("dragstart", onNativeStart, true)
    }
  }, [send, read, archive, stripRef])
}
