// client/root-target — where a root moves to, by drag or by key (ADR-0085).
// Pure.
//
// A root is dragged from the board or from your list. A drop names a target
// by the attributes the drop code marks it with (`rootDropProps`), and
// `planRootDrop` turns it into the intent a keyboard move sends: a board
// item's Move to ▸, and Move up and Move down (`stepsIn`) on both. Where in
// a group of places (`rootGroupProps`) the pointer lands is `landingIn`'s.

import {
  type EntryId,
  entryId,
  isRootId,
  isWorkflowStateId,
  type RootId,
  type WorkflowStateId,
} from "@pineta/core"
import type { Intent } from "./intent.ts"
import { gapAt } from "./reorder.ts"

/** The drag data type a root travels under, Pineta's own; never a card's. */
export const ROOT_MIME = "application/x-pineta-root"

/** A root being dragged: which, the state it is in, and where from. */
export interface RootDrag {
  readonly root: RootId
  readonly entry: EntryId
  readonly state: WorkflowStateId | null
}

export type RootTarget =
  /** A board column: before `before` there, or at its end. */
  | {
      readonly kind: "state"
      readonly state: WorkflowStateId
      readonly before: RootId | null
    }
  /** Your list: before `before`, or at its end. */
  | { readonly kind: "list"; readonly before: EntryId | null }

const ROOT_STATE = "data-root-state"
const ROOT_BEFORE = "data-root-before"
const LIST_BEFORE = "data-list-before"
/** What a list's end carries, where there is no root to go before. */
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

/** What a group of places matches: a board column, the closed state, your list. */
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
      before: before !== null && isRootId(before) ? before : null,
    }
  }
  const list = el.getAttribute(LIST_BEFORE)
  if (list === null || list === "") return null
  return { kind: "list", before: list === END ? null : entryId(list) }
}

/** Whether two targets are the same place. */
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
 * An item that is no place (a closed row) is at the group's end.
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
 * Move up and Move down for `item` in `order`, each null where it would do
 * nothing: up at the top, down at the bottom, both for an item not there.
 * Down goes before the item after next, since a move names what it goes
 * before.
 */
export function stepsIn<T>(
  order: readonly T[],
  item: T,
): { readonly up: Step<T> | null; readonly down: Step<T> | null } {
  const at = order.indexOf(item)
  if (at < 0) return { up: null, down: null }
  return {
    up: at === 0 ? null : { before: order[at - 1] ?? null },
    down: at === order.length - 1 ? null : { before: order[at + 2] ?? null },
  }
}

/** A drag's data, as it travels; `parseRootDrag` reads it back. */
export const encodeRootDrag = (drag: RootDrag): string => JSON.stringify(drag)

/** A drag's data, or null for anything else. */
export function parseRootDrag(text: string): RootDrag | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const { root, entry, state } = raw as Record<string, unknown>
  if (typeof root !== "string" || !isRootId(root)) return null
  if (typeof entry !== "string" || entry === "") return null
  if (
    state !== null &&
    (typeof state !== "string" || !isWorkflowStateId(state))
  )
    return null
  return { root, entry: entryId(entry), state }
}

/**
 * What a drop of `drag` on `target` asks: a move on the board, for a state
 * other than its own or a place in it; a place in your list. Null when it
 * would do nothing: a root dropped before itself, or on `home`, the place
 * just after it where it was dragged from (null when not known).
 */
export function planRootDrop(
  drag: RootDrag,
  target: RootTarget,
  closed: WorkflowStateId,
  home: RootTarget | null,
): Intent | null {
  if (home !== null && sameTarget(target, home)) return null
  if (target.kind === "list")
    return target.before === drag.entry
      ? null
      : { kind: "moveInList", root: drag.entry, before: target.before }
  if (drag.state === null || target.before === drag.root) return null
  return {
    kind: "moveRoot",
    root: drag.root,
    from: drag.state,
    to: target.state,
    before: target.before,
    closes: target.state === closed && drag.state !== closed,
  }
}
