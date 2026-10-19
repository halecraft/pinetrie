// interface/drag — what the one drag engine decides, as values; the page's
// engine (`packages/web/use-drag.ts`) gathers the pointer and decides nothing.
//
// A column is a card on a canvas drawn whole: its drag is its card's, and
// only over the strip does it reorder. Elsewhere it lands as any card does
// (`putLanding`).

import {
  type CanvasId,
  type CardId,
  isCanvasId,
  isSha256,
  isWorkflowStateId,
  parseCardId,
  type Sha256,
  type WorkflowStateId,
} from "@pinetrie/core"
import { imagesIn } from "@pinetrie/rules"
import { type Landing, type PutHow, putLanding } from "./card-intents.ts"
import type { IntentState } from "./effects.ts"
import { imageSpot } from "./image-edge.ts"
import type { Intent } from "./intent.ts"
import type { PutTarget } from "./put-target.ts"
import { landing, neighbourShifts } from "./reorder.ts"
import { planRootDrop, type RootDrag, type RootTarget } from "./root-target.ts"

/** A card dragged: a column's, a frame's, a slot's. */
export type CardSource = { readonly kind: "card"; readonly card: CardId }

/** A canvas dragged: a board card, a sidebar row. */
export type CanvasSource = { readonly kind: "canvas"; readonly drag: RootDrag }

/**
 * A stored image dragged: one a message, a tool's row or the pane draws, by
 * its blob, with the name it is put under.
 */
export type ImageSource = {
  readonly kind: "image"
  readonly sha256: Sha256
  readonly name: string
}

/** What a drag carries. */
export type DragSource = CardSource | CanvasSource | ImageSource

const DRAG_CARD = "data-drag-card"
const DRAG_CANVAS = "data-drag-canvas"
const DRAG_STATE = "data-drag-state"
const DRAG_IMAGE = "data-drag-image"
const DRAG_NAME = "data-drag-name"

/** What a handle a drag starts from matches. */
export const DRAG_HANDLE = `[${DRAG_CARD}],[${DRAG_CANVAS}],[${DRAG_IMAGE}]`

/** The attributes that mark an element as a handle for `source`, spread on it by the page. */
export function dragProps(
  source: DragSource,
): Readonly<Record<string, string>> {
  switch (source.kind) {
    case "card":
      return { [DRAG_CARD]: source.card }
    case "canvas":
      return {
        [DRAG_CANVAS]: source.drag.canvas,
        [DRAG_STATE]: source.drag.state ?? "",
      }
    case "image":
      return { [DRAG_IMAGE]: source.sha256, [DRAG_NAME]: source.name }
  }
}

/** The source a handle marks (`dragProps`); null for none. */
export function sourceOfElement(el: {
  getAttribute(name: string): string | null
}): DragSource | null {
  const card = parseCardId(el.getAttribute(DRAG_CARD) ?? "")
  if (card !== undefined) return { kind: "card", card }
  const image = el.getAttribute(DRAG_IMAGE) ?? ""
  if (isSha256(image))
    return {
      kind: "image",
      sha256: image,
      name: el.getAttribute(DRAG_NAME) ?? "",
    }
  const canvas = el.getAttribute(DRAG_CANVAS)
  if (canvas === null || !isCanvasId(canvas)) return null
  const state = el.getAttribute(DRAG_STATE) ?? ""
  return {
    kind: "canvas",
    drag: { canvas, state: isWorkflowStateId(state) ? state : null },
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

/** What a card's drag can be over, as the engine read it. */
export type CardOver =
  /** The strip, between its columns: `gap` is `pointerGap`'s. */
  | { readonly kind: "strip"; readonly gap: number }
  | { readonly kind: "put"; readonly target: PutTarget }
  /** ▦, which opens the board when held over; nothing lands on it. */
  | { readonly kind: "board" }
  | { readonly kind: "none" }

/** What a canvas's drag can be over: a place among canvases, or nothing. */
export type CanvasOver =
  | { readonly kind: "root"; readonly target: RootTarget }
  | { readonly kind: "none" }

/**
 * A drag this frame: its source, and what that source is over. A canvas's
 * drag cannot be over a card's drop zone, nor a card's over a canvas's place,
 * so no planner can mistake one for the other. It is a `DragSource` too.
 */
export type DragAt =
  | (CardSource & { readonly over: CardOver })
  | (ImageSource & { readonly over: CardOver })
  | (CanvasSource & { readonly over: CanvasOver })

/** What a drop there would do. */
export type PlannedDrop =
  /** A column moved along the strip, to `to`; null where it already is. */
  | { readonly kind: "reorder"; readonly to: number | null }
  /** A card landing on `target`, as `landing` says. */
  | {
      readonly kind: "land"
      readonly target: PutTarget
      readonly landing: Landing
    }
  | { readonly kind: "root"; readonly intent: Intent }
  /** A stored image put, as a new image or a version of one. */
  | { readonly kind: "image"; readonly intent: Intent }
  | { readonly kind: "nothing" }

/** What the press found, besides its source: the column's index, a canvas's place just after it. */
export interface DragFrom {
  /** The dragged column's index among the strip's card columns; null for no column. */
  readonly column: number | null
  /** A canvas's place just after it, where its drop moves nothing; null when not known. */
  readonly home: RootTarget | null
  /** The board's archive state, for a canvas's drop; null before the board has states. */
  readonly archive: WorkflowStateId | null
}

const NOTHING: PlannedDrop = { kind: "nothing" }

/** What dropping `at` where it is would do, `how` its Alt. */
export function planDrop(
  at: DragAt,
  from: DragFrom,
  how: PutHow,
  state: IntentState,
): PlannedDrop {
  if (at.kind === "canvas") {
    const { over } = at
    if (over.kind === "none" || from.archive === null) return NOTHING
    const intent = planRootDrop(at.drag, over.target, from.archive, from.home)
    return intent === null ? NOTHING : { kind: "root", intent }
  }
  if (at.kind === "image") return imageDrop(at, at.over, state)
  const { over } = at
  switch (over.kind) {
    case "strip":
      return from.column === null
        ? NOTHING
        : { kind: "reorder", to: landing(from.column, over.gap) }
    case "put": {
      const lands = putLanding(
        { kind: "card", card: at.card },
        over.target,
        how,
        state,
      )
      return lands.kind === "none"
        ? NOTHING
        : { kind: "land", target: over.target, landing: lands }
    }
    case "board":
    case "none":
      return NOTHING
  }
}

/**
 * What dropping a stored image `over` does: onto an image of a media column,
 * a version of it; elsewhere on one, a new image at its end; at a spot on a
 * canvas, a new image in a media column made there. Nothing anywhere else.
 */
function imageDrop(
  image: ImageSource,
  over: CardOver,
  state: IntentState,
): PlannedDrop {
  if (over.kind !== "put") return NOTHING
  const { target } = over
  const { sha256, name } = image
  switch (target.kind) {
    case "images": {
      const spot =
        target.on === null
          ? ({ kind: "spot", before: null } as const)
          : imageSpot(
              target.on.image,
              target.on.edge,
              imagesIn(state.cards.cards, target.column).map(c => c.id),
            )
      return {
        kind: "image",
        intent:
          spot.kind === "version"
            ? { kind: "addVersion", image: spot.image, sha256 }
            : {
                kind: "putStored",
                sha256,
                name,
                to: {
                  kind: "image-at",
                  column: target.column,
                  before: spot.before,
                },
              },
      }
    }
    case "canvas":
      return {
        kind: "image",
        intent: {
          kind: "putStored",
          sha256,
          name,
          to: { kind: "canvas-at", canvas: target.canvas, after: target.after },
        },
      }
    default:
      return NOTHING
  }
}

/**
 * The intents a drop sends: the ones a key or a menu would. A reorder is
 * `moveColumn`, a landing a `put`, a canvas's drop its own; each runs its
 * own planner, so a drop does what the put key or Move up does. The
 * planned drop holds all it needs besides its source.
 */
export function dropIntents(
  source: DragSource,
  drop: PlannedDrop,
  how: PutHow,
): readonly Intent[] {
  switch (drop.kind) {
    case "reorder":
      return drop.to === null || source.kind !== "card"
        ? []
        : [
            {
              kind: "moveColumn",
              column: { kind: "card", card: source.card },
              to: drop.to,
            },
          ]
    case "land":
      return source.kind === "card" && drop.landing.kind !== "refused"
        ? [
            {
              kind: "put",
              source: { kind: "card", card: source.card },
              target: drop.target,
              how,
            },
          ]
        : []
    case "root":
    case "image":
      return [drop.intent]
    case "nothing":
      return []
  }
}

/** How long a card's drag held onto a canvas in the sidebar, or over ▦, waits before opening it. */
export const ITEM_HOVER_MS = 600

/** What a card's drag is held over that opens after `ITEM_HOVER_MS`. */
export type HoverOver =
  | { readonly kind: "canvas"; readonly canvas: CanvasId }
  | { readonly kind: "board" }
  /** Your inventory, from its toggle, where a drop takes the card. */
  | { readonly kind: "inventory" }
  | { readonly kind: "none" }

const NO_HOVER: HoverOver = { kind: "none" }

/**
 * What holding the drag where it is opens: the sidebar canvas a card is onto
 * (a row's middle, `sidebarSpot`), the board from ▦, or your inventory from
 * its toggle, which aims at no slot (a drop there takes). A canvas's drag
 * lands only between canvases, never onto one, so it opens nothing.
 */
function heldOpens(at: DragAt): HoverOver {
  if (at.kind === "canvas") return NO_HOVER
  const { over } = at
  switch (over.kind) {
    case "put":
      return over.target.kind === "item"
        ? { kind: "canvas", canvas: over.target.canvas }
        : over.target.kind === "inventory" && over.target.slot === null
          ? { kind: "inventory" }
          : NO_HOVER
    case "board":
      return { kind: "board" }
    case "strip":
    case "none":
      return NO_HOVER
  }
}

/** What being held over `over` opens: a canvas in the sidebar, the board, or your inventory. */
export function hoverOpens(over: HoverOver): Intent | null {
  switch (over.kind) {
    case "canvas":
      return { kind: "show", here: { kind: "canvas", canvas: over.canvas } }
    case "board":
      return { kind: "board", open: true, focus: false }
    case "inventory":
      return { kind: "inventory", act: { kind: "show", how: "held" } }
    case "none":
      return null
  }
}

/**
 * A row of the sidebar the pointer is over, for a card's drag: onto its
 * canvas in the middle half, between it and the one above in its top
 * quarter, and between it and the one below in its bottom quarter. A
 * canvas's drag has no put target (`CanvasOver`), so it never reads one.
 */
export function sidebarSpot(
  y: number,
  row: { readonly top: number; readonly height: number },
  canvas: CanvasId,
  next: CanvasId | null,
): PutTarget {
  const at = (y - row.top) / row.height
  if (at < 0.25) return { kind: "sidebar", before: canvas }
  if (at > 0.75) return { kind: "sidebar", before: next }
  return { kind: "item", canvas }
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

/**
 * How a planned drop is marked on its target: a canvas's landing as `root`
 * (`data-root-drop`), any other as what it would do (`data-drop-mark`).
 */
export type DropMark = "root" | "move" | "copy" | "replace" | "refused"

/** What one frame draws: applied by the engine to `style` and `dataset`, nothing else. */
export interface DrawPlan {
  /** The dragged element's translate; null while it is hidden. Never a scale, a rotation or a shadow on it. */
  readonly dragged: Point | null
  /** The ghost's position, at compact's size under the pointer; null while the column is drawn instead. */
  readonly ghost: Point | null
  /** Each column's `translateX`, opening the gap a column would land in. */
  readonly shifts: readonly number[]
  readonly mark: DropMark | null
  /** The handle's lean, in degrees, from the pointer's speed. */
  readonly lean: number
  /** What holding here opens, ringed on the target until it does (`heldOpens`). */
  readonly opens: HoverOver
}

/** How a planned drop is marked: what it would do there. */
export function dropMark(drop: PlannedDrop, how: PutHow): DropMark | null {
  switch (drop.kind) {
    case "reorder":
      return null
    case "root":
      return "root"
    case "image":
      return "copy"
    case "nothing":
      return null
    case "land":
      return drop.landing.kind === "refused"
        ? "refused"
        : drop.landing.kind === "replace"
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
 * pointer is over it, and leaves it as its ghost; anything else moves
 * whole. The dragged element only ever translates: a scaled, rotated or
 * shadowed column costs frames on a slow machine, and the lift is drawn on
 * its handle instead. The target's mark and what a hold there opens are
 * drawn from the same values.
 */
export function drawPlan(
  armed: Armed,
  pointer: Point,
  speed: number,
  at: DragAt,
  drop: PlannedDrop,
  how: PutHow,
): DrawPlan {
  const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, speed * LEAN_PER_PX))
  const mark = dropMark(drop, how)
  const opens = heldOpens(at)
  const still = armed.widths.map(() => 0)
  const { strip } = armed
  if (!armed.column || strip === null)
    return {
      dragged: { x: pointer.x - armed.start.x, y: pointer.y - armed.start.y },
      ghost: null,
      shifts: still,
      mark,
      lean,
      opens,
    }
  const onStrip =
    pointer.x >= strip.left &&
    pointer.x <= strip.right &&
    pointer.y >= strip.top &&
    pointer.y <= strip.bottom
  if (!onStrip)
    return { dragged: null, ghost: pointer, shifts: still, mark, lean, opens }
  return {
    dragged: { x: pointer.x - armed.start.x, y: 0 },
    ghost: null,
    shifts:
      at.over.kind === "strip" && armed.from !== null
        ? neighbourShifts(armed.from, at.over.gap, armed.widths)
        : still,
    mark,
    lean,
    opens,
  }
}
