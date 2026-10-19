// interface/drag — what a drag carries, what it can be over, and what a drop
// there does, as values: the intents a key or a menu would send. How the web
// client finds a drag's source and target under the pointer, and draws each
// frame, is web-core's (`drag.ts`).
//
// A column is a card on a canvas drawn whole: its drag is its card's, and
// only over the strip does it reorder. Elsewhere it lands as any card does
// (`putLanding`).

import type { Sha256, WorkflowStateId } from "@pinetrie/core"
import { imagesIn } from "@pinetrie/rules"
import type { CardId } from "@pinetrie/threads"
import { type Landing, type PutHow, putLanding } from "./card-intents.ts"
import type { IntentState } from "./effects.ts"
import { imageSpot } from "./image-edge.ts"
import type { Intent } from "./intent.ts"
import type { PutTarget } from "./put-target.ts"
import { landing } from "./reorder.ts"
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
            ? { kind: "add-version", image: spot.image, sha256 }
            : {
                kind: "put-images",
                images: [{ sha256, name }],
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
          kind: "put-images",
          images: [{ sha256, name }],
          to: { kind: "canvas-at", canvas: target.canvas, after: target.after },
        },
      }
    default:
      return NOTHING
  }
}

/**
 * The intents a drop sends: the ones a key or a menu would. A reorder is
 * `move-column`, a landing a `put`, a canvas's drop its own; each runs its
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
              kind: "move-column",
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
