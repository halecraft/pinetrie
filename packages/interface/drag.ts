// interface/drag — what the one drag engine decides, as values; the page's
// engine (`packages/web/use-drag.ts`) gathers the pointer and decides nothing.
//
// A column is a card on a canvas drawn whole: its drag is its card's, and
// only over the strip does it reorder. Elsewhere it lands as any card does
// (`putLanding`).

import {
  type CardId,
  isTaskId,
  isWorkflowStateId,
  parseCardId,
  type TaskId,
  type WorkflowStateId,
} from "@pinetrie/core"
import { type Landing, type PutHow, putLanding } from "./card-intents.ts"
import type { IntentState } from "./effects.ts"
import type { Intent } from "./intent.ts"
import type { PutTarget } from "./put-target.ts"
import { landing, neighbourShifts } from "./reorder.ts"
import { planRootDrop, type RootDrag, type RootTarget } from "./root-target.ts"

/** What a drag carries: a card (a column's, a frame's, a slot's), or a task. */
export type DragSource =
  | { readonly kind: "card"; readonly card: CardId }
  | { readonly kind: "task"; readonly drag: RootDrag }

const DRAG_CARD = "data-drag-card"
const DRAG_TASK = "data-drag-task"
const DRAG_STATE = "data-drag-state"

/** What a handle a drag starts from matches. */
export const DRAG_HANDLE = `[${DRAG_CARD}],[${DRAG_TASK}]`

/** The attributes that mark an element as a handle for `source`, spread on it by the page. */
export function dragProps(
  source: DragSource,
): Readonly<Record<string, string>> {
  return source.kind === "card"
    ? { [DRAG_CARD]: source.card }
    : {
        [DRAG_TASK]: source.drag.task,
        [DRAG_STATE]: source.drag.state ?? "",
      }
}

/** The source a handle marks (`dragProps`); null for none. */
export function sourceOfElement(el: {
  getAttribute(name: string): string | null
}): DragSource | null {
  const card = parseCardId(el.getAttribute(DRAG_CARD) ?? "")
  if (card !== undefined) return { kind: "card", card }
  const task = el.getAttribute(DRAG_TASK)
  if (task === null || !isTaskId(task)) return null
  const state = el.getAttribute(DRAG_STATE) ?? ""
  return {
    kind: "task",
    drag: { task, state: isWorkflowStateId(state) ? state : null },
  }
}

/**
 * Where a press starts no drag: a text field, a select, an open menu. A
 * button or a link inside a handle does, once the press moves past
 * `DRAG_START`; one that does not is its click.
 */
export const NOT_A_HANDLE =
  "input, textarea, select, [contenteditable='true'], [role='menu']"

/** How far, in px, a press moves before it is a drag rather than a click. */
export const DRAG_START = 5

/** What is under the pointer, as the engine read it. */
export type DragOver =
  /** The strip, between its columns: `gap` is `gapAt`'s. */
  | { readonly kind: "strip"; readonly gap: number }
  | { readonly kind: "put"; readonly target: PutTarget }
  | { readonly kind: "root"; readonly target: RootTarget }
  | { readonly kind: "none" }

/** What a drop there would do. */
export type DragVerdict =
  /** A column moved along the strip, to `to`; null where it already is. */
  | { readonly kind: "reorder"; readonly to: number | null }
  | { readonly kind: "land"; readonly landing: Landing }
  | { readonly kind: "root"; readonly intent: Intent }
  | { readonly kind: "nothing" }

/** What the press found, besides its source: the column's index, a task's place just after it. */
export interface DragFrom {
  /** The dragged column's index among the strip's card columns; null for no column. */
  readonly column: number | null
  /** A task's place just after it, where its drop moves nothing; null when not known. */
  readonly home: RootTarget | null
  /** The board's archive state, for a task's drop; null before the board has states. */
  readonly archive: WorkflowStateId | null
}

const NOTHING: DragVerdict = { kind: "nothing" }

/** What dropping `source` over `over` would do, `how` its Alt. */
export function dragVerdict(
  source: DragSource,
  from: DragFrom,
  over: DragOver,
  how: PutHow,
  state: IntentState,
): DragVerdict {
  if (source.kind === "task") {
    if (over.kind !== "root" || from.archive === null) return NOTHING
    const intent = planRootDrop(
      source.drag,
      over.target,
      from.archive,
      from.home,
    )
    return intent === null ? NOTHING : { kind: "root", intent }
  }
  if (over.kind === "strip")
    return from.column === null
      ? NOTHING
      : { kind: "reorder", to: landing(from.column, over.gap) }
  if (over.kind !== "put") return NOTHING
  const lands = putLanding(
    { kind: "card", card: source.card },
    over.target,
    how,
    state,
  )
  return lands.kind === "none" ? NOTHING : { kind: "land", landing: lands }
}

/**
 * The intents a drop sends: the ones a key or a menu would. A reorder is
 * `moveColumn`, a landing a `put`, a task's drop its own; each runs its
 * own planner, so a drop does what the put key or Move up does.
 */
export function dropIntents(
  source: DragSource,
  over: DragOver,
  verdict: DragVerdict,
  how: PutHow,
): readonly Intent[] {
  switch (verdict.kind) {
    case "reorder":
      return verdict.to === null || source.kind !== "card"
        ? []
        : [
            {
              kind: "moveColumn",
              column: { kind: "card", card: source.card },
              to: verdict.to,
            },
          ]
    case "land":
      return source.kind === "card" &&
        over.kind === "put" &&
        verdict.landing.kind !== "refused"
        ? [
            {
              kind: "put",
              source: { kind: "card", card: source.card },
              target: over.target,
              how,
            },
          ]
        : []
    case "root":
      return [verdict.intent]
    case "nothing":
      return []
  }
}

/** How long a drag held over a task in the sidebar, or ▦, waits before opening it. */
export const ITEM_HOVER_MS = 600

/** What a drag is held over that opens after `ITEM_HOVER_MS`. */
export type HoverOver =
  | { readonly kind: "task"; readonly task: TaskId }
  | { readonly kind: "board" }
  | { readonly kind: "none" }

/** What being held over `over` opens: a task in the sidebar, or the board. */
export function hoverOpens(over: HoverOver): Intent | null {
  switch (over.kind) {
    case "task":
      return { kind: "show", here: { kind: "task", task: over.task } }
    case "board":
      return { kind: "board", open: true, focus: false }
    case "none":
      return null
  }
}

/**
 * A row of the sidebar the pointer is over: onto its task in the middle
 * half, between it and the one above in its top quarter, and between it
 * and the one below in its bottom quarter. Only a card's drag reads it; a
 * task's drag reorders among the rows.
 */
export function sidebarSpotAt(
  y: number,
  row: { readonly top: number; readonly height: number },
  task: TaskId,
  next: TaskId | null,
): PutTarget {
  const at = (y - row.top) / row.height
  if (at < 0.25) return { kind: "sidebar", before: task }
  if (at > 0.75) return { kind: "sidebar", before: next }
  return { kind: "task", task }
}

/** A point on the page. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** What the press measured once, so no frame measures it again. */
export interface Armed {
  readonly start: Point
  /** Whether what is dragged is a column on the strip. */
  readonly column: boolean
  /** The strip's box, for a column's drag; null for any other. */
  readonly strip: {
    readonly left: number
    readonly right: number
    readonly top: number
    readonly bottom: number
  } | null
  /** The dragged column's index, and every column's width, for a column's drag. */
  readonly from: number | null
  readonly widths: readonly number[]
}

/** How a verdict is marked on its target. */
export type DropMark = "move" | "copy" | "replace" | "refused"

/** What one frame draws: applied by the engine to `style` and `dataset`, nothing else. */
export interface DrawPlan {
  /** The dragged element's translate; null while it is hidden. Never a scale, a rotation or a shadow on it. */
  readonly dragged: Point | null
  /** The card face's position, under the pointer; null while the column is drawn instead. */
  readonly face: Point | null
  /** Each column's `translateX`, opening the gap a column would land in. */
  readonly shifts: readonly number[]
  readonly mark: DropMark | null
  /** The handle's lean, in degrees, from the pointer's speed. */
  readonly lean: number
}

/** How a verdict is marked: what it would do there. */
export function dropMark(verdict: DragVerdict, how: PutHow): DropMark | null {
  switch (verdict.kind) {
    case "reorder":
      return null
    case "root":
      return "move"
    case "nothing":
      return null
    case "land":
      return verdict.landing.kind === "refused"
        ? "refused"
        : verdict.landing.kind === "replace"
          ? "replace"
          : how === "copy"
            ? "copy"
            : "move"
  }
}

const LEAN_PER_PX = 0.15
const MAX_LEAN = 3

/**
 * What to draw this frame. A column is slid along the strip while the
 * pointer is over it, and leaves it as its card face; anything else moves
 * whole. The dragged element only ever translates: a scaled, rotated or
 * shadowed column costs frames on a slow machine, and the lift is drawn on
 * its handle instead.
 */
export function drawPlan(
  armed: Armed,
  pointer: Point,
  speed: number,
  over: DragOver,
  verdict: DragVerdict,
  how: PutHow,
): DrawPlan {
  const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, speed * LEAN_PER_PX))
  const mark = dropMark(verdict, how)
  const still = armed.widths.map(() => 0)
  const { strip } = armed
  if (!armed.column || strip === null)
    return {
      dragged: { x: pointer.x - armed.start.x, y: pointer.y - armed.start.y },
      face: null,
      shifts: still,
      mark,
      lean,
    }
  const onStrip =
    pointer.x >= strip.left &&
    pointer.x <= strip.right &&
    pointer.y >= strip.top &&
    pointer.y <= strip.bottom
  if (!onStrip)
    return { dragged: null, face: pointer, shifts: still, mark, lean }
  return {
    dragged: { x: pointer.x - armed.start.x, y: 0 },
    face: null,
    shifts:
      over.kind === "strip" && armed.from !== null
        ? neighbourShifts(armed.from, over.gap, armed.widths)
        : still,
    mark,
    lean,
  }
}
