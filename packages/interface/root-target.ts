// interface/root-target — where a canvas moves to, by drag or by key.
//
// A canvas is dragged from the board or from the sidebar. A drop names a target
// by the attributes the page marks it with (`rootDropProps`), and
// `planRootDrop` turns it into an intent: on the board, the one a board
// item's Move to ▸, Move up or Move down (`stepsIn`) sends; on the sidebar, a
// `moveInList`. Where in a group of places (`rootGroupProps`) the pointer
// lands is `landingIn`'s.

import {
  type CanvasId,
  isCanvasId,
  isWorkflowStateId,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Intent } from "./intent.ts"
import { gapAt } from "./reorder.ts"

/** A canvas being dragged: which, and the state it is in. */
export interface RootDrag {
  readonly canvas: CanvasId
  readonly state: WorkflowStateId | null
}

export type RootTarget =
  /** A board column: before `before` there, or at its end. */
  | {
      readonly kind: "state"
      readonly state: WorkflowStateId
      readonly before: CanvasId | null
    }
  /** The sidebar: before `before`, or at its end. */
  | { readonly kind: "list"; readonly before: CanvasId | null }

const ROOT_STATE = "data-root-state"
const ROOT_BEFORE = "data-root-before"
const LIST_BEFORE = "data-list-before"
/** What a list's end carries, where there is no canvas to go before. */
const END = "end"

const ROOT_GROUP = "data-root-group"

/** What an element a root's drop may land on matches. */
export const ROOT_DROP_ZONE = `[${ROOT_STATE}],[${LIST_BEFORE}]`

/** The attributes that mark an element as `target`, spread onto it by the page. */
export function rootDropProps(
  target: RootTarget,
): Readonly<Record<string, string>> {
  return target.kind === "state"
    ? {
        [ROOT_STATE]: target.state,
        ...(target.before === null ? {} : { [ROOT_BEFORE]: target.before }),
      }
    : { [LIST_BEFORE]: target.before ?? END }
}

/** What a group of places matches: a board column, the archive, the sidebar. */
export const ROOT_GROUP_ZONE = `[${ROOT_GROUP}]`

/** The attribute that marks an element as a group of places. */
export const rootGroupProps: Readonly<Record<string, string>> = {
  [ROOT_GROUP]: "",
}

/** The target an element marks (`rootDropProps`); null for none. */
export function rootTargetOfElement(el: {
  getAttribute(name: string): string | null
}): RootTarget | null {
  const state = el.getAttribute(ROOT_STATE)
  if (state !== null && isWorkflowStateId(state)) {
    const before = el.getAttribute(ROOT_BEFORE)
    return {
      kind: "state",
      state,
      before: before !== null && isCanvasId(before) ? before : null,
    }
  }
  const list = el.getAttribute(LIST_BEFORE)
  if (list === null || list === "") return null
  if (list === END) return { kind: "list", before: null }
  return isCanvasId(list) ? { kind: "list", before: list } : null
}

export const sameTarget = (a: RootTarget, b: RootTarget): boolean =>
  a.kind === "state"
    ? b.kind === "state" && a.state === b.state && a.before === b.before
    : b.kind === "list" && a.before === b.before

/**
 * Where a drop lands in a group, its items in order with their centres:
 * before the first whose centre is below the pointer's `y`, or at `end`.
 * Anywhere in the group lands, the gaps between items too, so the place
 * changes only as the pointer passes an item's centre.
 */
export function landingIn<Z>(
  items: readonly { readonly zone: Z; readonly mid: number }[],
  end: Z,
  y: number,
): Z {
  const gap = gapAt(
    items.map(i => i.mid),
    y,
  )
  return items[gap]?.zone ?? end
}

/**
 * The place just after `item` in a group: where a drop of it moves nothing.
 * An item that is no place (an archive row) is at the group's end.
 */
export function placeAfter<Z>(zones: readonly Z[], item: Z, end: Z): Z {
  const at = zones.indexOf(item)
  return at < 0 ? end : (zones[at + 1] ?? end)
}

/** Where Move up or Move down puts an item: before `before`, or at the end. */
export interface Step<T> {
  readonly before: T | null
}

/**
 * Move up and Move down for `item`, among the items of `order` that
 * `isShown` keeps, so every move is seen. Up goes before the nearest shown
 * item above. Down goes after the nearest shown item below, so before what
 * follows that item in `order`: a move names what it goes before. Each is
 * null where it would do nothing: up at the top, down at the bottom, both
 * for an item not shown.
 */
export function stepsIn<T>(
  order: readonly T[],
  item: T,
  isShown: (t: T) => boolean,
): { readonly up: Step<T> | null; readonly down: Step<T> | null } {
  const at = order.indexOf(item)
  if (at < 0 || !isShown(item)) return { up: null, down: null }
  const above = order.slice(0, at).findLast(isShown)
  const belowAt = order.findIndex((t, i) => i > at && isShown(t))
  return {
    up: above === undefined ? null : { before: above },
    down: belowAt < 0 ? null : { before: order[belowAt + 1] ?? null },
  }
}

/**
 * What a drop of `drag` on `target` asks: a move on the board, for a state
 * other than its own or a place in it; a place in the sidebar. Null when it
 * would do nothing: a canvas dropped before itself, or on `home`, the place
 * just after it where it was dragged from (null when not known).
 */
export function planRootDrop(
  drag: RootDrag,
  target: RootTarget,
  archive: WorkflowStateId,
  home: RootTarget | null,
): Intent | null {
  if (home !== null && sameTarget(target, home)) return null
  if (target.kind === "list")
    return target.before === drag.canvas
      ? null
      : { kind: "moveInList", canvas: drag.canvas, before: target.before }
  if (drag.state === null || target.before === drag.canvas) return null
  return {
    kind: "moveCanvas",
    canvas: drag.canvas,
    from: drag.state,
    to: target.state,
    before: target.before,
    closes: target.state === archive && drag.state !== archive,
  }
}
