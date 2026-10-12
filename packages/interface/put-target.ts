// interface/put-target — where a put, a drop or a paste lands.
//
// Every input makes the same moves: a drop names a target by the attribute
// the drop code marks it with, and a put by key or button names the same
// target. Both become a place through `placeOfTarget`, from the place a
// column's composer creates your message in (`composerPlace`), published per
// column with the message there. So every place a drag can drop on is
// reachable by put, and every place put reaches accepts a drop.

import {
  type BackTarget,
  type CanvasTarget,
  type CardId,
  isNoteColumnId,
  isTaskId,
  isWorkflowStateId,
  keyOf,
  type NoteColumnId,
  noteOf,
  parseCardId,
  pinnedOf,
  sameKey,
  type TargetOf,
  type TaskId,
  type TextPlace,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import type { Focus } from "./focus.ts"

export type PutTarget =
  /**
   * A thread's column: a note in the note column nearest it (`noteOf`).
   */
  | { readonly kind: "column"; readonly key: string }
  /** A column's composer: your message, which a message with text there gives way to by a swap. */
  | { readonly kind: "composer"; readonly key: string }
  /** A note column: a note at its end. */
  | { readonly kind: "notes"; readonly column: NoteColumnId }
  /**
   * A spot on a task's canvas, just after `after` (first for null), where
   * no column takes a drop: a folded column, or the canvas past its last.
   * A thread's card or a note column lands there; a text card or a
   * reference in a note column made for it there (`WRAPS`).
   */
  | {
      readonly kind: "canvas"
      readonly task: TaskId
      readonly after: CardId | null
    }
  /** The pinned strip at the top of a thread's column. */
  | { readonly kind: "pinned"; readonly key: string }
  /** The cards pinned to a task, in its task column. */
  | { readonly kind: "taskPinned"; readonly task: TaskId }
  /**
   * Your inventory: a slot aimed at (a drop on it, a paste on it), or, with
   * null, none (a take, keep): the selected slot if empty, else the first
   * empty one.
   */
  | { readonly kind: "inventory"; readonly slot: number | null }
  /** A workflow state, on the board or the footer's strip: a new thread there. */
  | { readonly kind: "state"; readonly state: WorkflowStateId }
  /**
   * A place in the sidebar, before a task or at its end: a new task there,
   * a thread spun from a text card, or holding a column dropped there.
   */
  | { readonly kind: "sidebar"; readonly before: TaskId | null }
  /** A task in the sidebar, onto it: a column moves to the end of its canvas. */
  | { readonly kind: "task"; readonly task: TaskId }
  /**
   * The text box that has focus: a paste there types its text, or a link to
   * what it names, at the caret. Nothing is put or dropped into one.
   */
  | { readonly kind: "text-box" }

/** A spot on a task's canvas: where a drop past a column, or a column ＋ makes, lands. */
export type CanvasPut = Extract<PutTarget, { readonly kind: "canvas" }>

/** The attribute a column's drop zone carries: its key. */
const PUT_COLUMN = "data-put-column"
/** The attribute a column's composer carries: its column's key. */
const PUT_COMPOSER = "data-put-composer"
/** The attribute a column's pinned strip carries: its column's key. */
const PUT_PINNED = "data-put-pinned"
/** The attribute a task column's pinned cards carry: its task. */
const PUT_TASK_PINNED = "data-put-task-pinned"
/** The attribute a slot carries: its index. */
const PUT_SLOT = "data-put-slot"
/** The attribute a note column carries: its id. */
const PUT_NOTES = "data-put-notes"
/** The attribute a spot on a canvas carries: its task. */
const PUT_CANVAS = "data-put-canvas"
/** Beside `PUT_CANVAS`: the card the spot is after, absent for first. */
const PUT_AFTER = "data-put-after"
/** The attribute a workflow state carries, on the board and the footer's strip: its id. */
const PUT_STATE = "data-put-state"
/** The attribute a place in the sidebar carries: the task it goes before, or `end`. */
const PUT_SIDEBAR = "data-put-sidebar"
const END = "end"
/** The attribute a task's row in the sidebar carries, a drop onto it: its id. */
const PUT_TASK = "data-put-task"

/** What an element a drop may land on matches: any mark. */
export const DROP_ZONE = `[${PUT_COLUMN}],[${PUT_COMPOSER}],[${PUT_PINNED}],[${PUT_TASK_PINNED}],[${PUT_SLOT}],[${PUT_NOTES}],[${PUT_CANVAS}],[${PUT_STATE}],[${PUT_SIDEBAR}],[${PUT_TASK}]`

/** The attributes that mark an element as `target`, spread onto it by the page. */
export function dropProps(target: PutTarget): Readonly<Record<string, string>> {
  switch (target.kind) {
    case "column":
      return { [PUT_COLUMN]: target.key }
    case "composer":
      return { [PUT_COMPOSER]: target.key }
    case "pinned":
      return { [PUT_PINNED]: target.key }
    case "taskPinned":
      return { [PUT_TASK_PINNED]: target.task }
    case "inventory":
      return target.slot === null ? {} : { [PUT_SLOT]: String(target.slot) }
    case "notes":
      return { [PUT_NOTES]: target.column }
    case "canvas":
      return target.after === null
        ? { [PUT_CANVAS]: target.task }
        : { [PUT_CANVAS]: target.task, [PUT_AFTER]: target.after }
    case "state":
      return { [PUT_STATE]: target.state }
    case "sidebar":
      return { [PUT_SIDEBAR]: target.before ?? END }
    case "task":
      return { [PUT_TASK]: target.task }
    // A text box is pasted into alone: no drop lands there.
    case "text-box":
      return {}
  }
}

/** The target an element marks (`dropProps`); null for none. */
export function targetOfElement(el: {
  getAttribute(name: string): string | null
}): PutTarget | null {
  const key = el.getAttribute(PUT_COLUMN)
  if (key !== null && key !== "") return { kind: "column", key }
  const composer = el.getAttribute(PUT_COMPOSER)
  if (composer !== null && composer !== "")
    return { kind: "composer", key: composer }
  const pinned = el.getAttribute(PUT_PINNED)
  if (pinned !== null && pinned !== "") return { kind: "pinned", key: pinned }
  const task = el.getAttribute(PUT_TASK_PINNED)
  if (task !== null && isTaskId(task)) return { kind: "taskPinned", task }
  const state = el.getAttribute(PUT_STATE)
  if (state !== null && isWorkflowStateId(state))
    return { kind: "state", state }
  const onto = el.getAttribute(PUT_TASK)
  if (onto !== null && isTaskId(onto)) return { kind: "task", task: onto }
  const before = el.getAttribute(PUT_SIDEBAR)
  if (before === END) return { kind: "sidebar", before: null }
  if (before !== null && isTaskId(before)) return { kind: "sidebar", before }
  const notes = el.getAttribute(PUT_NOTES)
  if (notes !== null && isNoteColumnId(notes))
    return { kind: "notes", column: notes }
  const canvas = el.getAttribute(PUT_CANVAS)
  if (canvas !== null && isTaskId(canvas)) {
    const after = el.getAttribute(PUT_AFTER)
    if (after === null) return { kind: "canvas", task: canvas, after: null }
    const card = parseCardId(after)
    return card === undefined
      ? null
      : { kind: "canvas", task: canvas, after: card }
  }
  const slot = el.getAttribute(PUT_SLOT)
  if (slot === null || !/^\d+$/.test(slot)) return null
  return { kind: "inventory", slot: Number(slot) }
}

/**
 * Where a put or a paste lands, from where focus is: the text box that has
 * focus, else the drop zone around focus, else the column last focused; null
 * with none of them.
 */
export function targetOfFocus(
  focus: Pick<Focus, "inText" | "zone" | "column">,
): PutTarget | null {
  if (focus.inText) return { kind: "text-box" }
  if (focus.zone !== null) return focus.zone
  return focus.column === null ? null : { kind: "column", key: focus.column }
}

/** What a column publishes of its composer: where it makes your message, and the message there. */
export interface ComposerSpot {
  /** Where it creates your message (`composerPlace`). */
  readonly place: TextPlace
  /** Your message there, if you have one (`yourCard`). */
  readonly message: CardId | null
}

/** Column key to its composer (`ComposerSpot`). */
export type ComposerPlaces = ReadonlyMap<string, ComposerSpot>

/** Whether a put on `target` lands in a composer, as your message. */
export const intoMessage = (target: PutTarget): boolean =>
  target.kind === "composer"

/**
 * The place `target` names: the note column nearest a column's thread
 * (`noteOf`), a note column's end, its composer's place, the same thread
 * end pinned (`pinnedOf`), a task's pinned cards, or your inventory; null
 * for a column no composer publishes; and for a state or the sidebar, which name a new thread, not a place
 * (`planSpinOff`); and for a spot on a canvas, which the host ranks.
 */
export function placeOfTarget(
  target: PutTarget,
  places: ComposerPlaces,
  me: WriterId,
): Exclude<TargetOf<"text">, CanvasTarget | BackTarget> | null {
  if (target.kind === "inventory") return { kind: "inventory", holder: me }
  if (target.kind === "notes") return { kind: "note", column: target.column }
  if (target.kind === "taskPinned")
    return { kind: "task-pinned", task: target.task }
  if (
    target.kind === "state" ||
    target.kind === "sidebar" ||
    target.kind === "task" ||
    target.kind === "text-box" ||
    target.kind === "canvas"
  )
    return null
  const place = places.get(target.key)?.place
  if (place === undefined) return null
  if (target.kind === "pinned") return pinnedOf(place)
  if (target.kind === "column" && place.kind === "composing")
    return noteOf(place)
  return keyOf(place)
}

/** A store each column writes its composer to as it renders; reading it redraws nothing. */
export interface ComposerPlacesStore {
  readonly current: () => ComposerPlaces
  set(key: string, spot: ComposerSpot | null): void
}

export function composerPlacesStore(): ComposerPlacesStore {
  let places: ComposerPlaces = new Map()
  return {
    current: () => places,
    set(key, spot) {
      const now = places.get(key)
      if (
        spot === null
          ? now === undefined
          : now !== undefined &&
            now.message === spot.message &&
            sameKey(keyOf(now.place), keyOf(spot.place))
      )
        return
      const next = new Map(places)
      if (spot === null) next.delete(key)
      else next.set(key, spot)
      places = next
    },
  }
}
