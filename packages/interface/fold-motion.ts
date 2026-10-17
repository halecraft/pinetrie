// interface/fold-motion — how a column folds into its strip, or unfolds from
// it, as a value: what moves where, sampled over the motion. The shell
// measures the wide column and plays what this returns
// (`packages/web/use-fold-motion.ts`).

import type { ColumnKey } from "./columns.ts"
import type { LayoutAction } from "./layout.ts"

/** A box on the page, as `getBoundingClientRect` gives it, in px. */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A strip's layout, from its registered `--strip-*` properties, in px. */
export interface StripGeometry {
  readonly width: number
  /** From the strip's top to its mark's. */
  readonly markTop: number
  /** From the strip's top to its name's. */
  readonly nameTop: number
  /** The longest name the strip shows. */
  readonly nameMax: number
}

/** What a fold or an unfold sees, measured where the column is wide. */
export interface FoldScene {
  readonly unfolding: boolean
  /** The wide column, its name's line box and its mark's box. */
  readonly wide: {
    readonly column: Rect
    readonly name: Rect | null
    readonly mark: Rect | null
  }
  /** Whether the strip draws a mark (a thread's does). */
  readonly stripMark: boolean
  readonly geometry: StripGeometry
  /** The name's line height. */
  readonly line: number
  /** The strip's visible box. */
  readonly view: Rect
  /** The strip's scroll, as the wide column leaves it. */
  readonly scroll: {
    readonly left: number
    readonly width: number
    readonly client: number
  }
  readonly reducedMotion: boolean
  readonly dragging: boolean
}

/** A move from where an element is wide to where it is in the strip. */
export interface Shift {
  readonly dx: number
  readonly dy: number
}

/**
 * One sample of the motion. `fold` is how far folded it is, 0 wide to 1 a
 * strip; `inset` how far the column's right edge has come in from its full
 * width, in px. The clip and every column after it follow that one edge.
 */
export interface FoldFrame {
  readonly offset: number
  readonly fold: number
  readonly inset: number
}

export interface FoldMotion {
  readonly duration: number
  readonly frames: readonly FoldFrame[]
  /**
   * The name, folded: turned 90° clockwise about its own top-left corner,
   * then moved by this. Null when it fades with the rest instead.
   */
  readonly turn: Shift | null
  /** The mark, folded: moved by this, unturned. Null when it fades instead. */
  readonly mark: Shift | null
  /** The opacity of everything else in the column, by offset. */
  readonly fade: readonly {
    readonly offset: number
    readonly opacity: number
  }[]
  /**
   * How far every column moves right once folded: the scroll the browser
   * clamps when the strip's scroll width shrinks below it.
   */
  readonly clamp: number
}

const FOLD_MS = 200

/** Samples after the first. The edge is kept clear of the turn at each, and played linearly between. */
const SAMPLES = 8

/** How far the edge stays clear of the turning name and mark, in px. */
const CLEAR = 2

/** How close two lengths count as the same, in px. */
const SAME = 0.5

/** A column's fold, as its layout action names it, and which way. */
export interface ColumnMotion {
  readonly column: ColumnKey
  readonly unfolded: boolean
}

/** The column a layout action folds or unfolds, and which way; null for any other action. */
export function foldOf(action: LayoutAction): ColumnMotion | null {
  if (action.kind !== "view") return null
  const { change } = action
  switch (change.kind) {
    case "fold":
      return {
        column: { kind: "card", card: change.card },
        unfolded: change.unfolded,
      }
    case "foldCanvas":
      return {
        column: { kind: "canvas", canvas: action.canvas },
        unfolded: change.unfolded,
      }
    default:
      return null
  }
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3

const meets = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height

/**
 * The right edge of `box` turned `degrees` clockwise about its own top-left
 * corner and moved by `by`.
 */
function rightOf(box: Rect, degrees: number, by: Shift): number {
  const a = (degrees * Math.PI) / 180
  const corners = [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ] as const
  return (
    box.left +
    by.dx +
    Math.max(...corners.map(([x, y]) => x * Math.cos(a) - y * Math.sin(a)))
  )
}

const scaled = (s: Shift, by: number): Shift => ({
  dx: s.dx * by,
  dy: s.dy * by,
})

/**
 * How the column in `scene` moves, or null when it does not: under reduced
 * motion, during a drag, out of view, or already no wider than its strip.
 */
export function planFoldMotion(scene: FoldScene): FoldMotion | null {
  const { wide, geometry, line } = scene
  const width = wide.column.width
  const narrowing = width - geometry.width
  if (scene.reducedMotion || scene.dragging) return null
  if (narrowing <= SAME || !meets(wide.column, scene.view)) return null
  // The strip, predicted: where it lies once the column is folded, before
  // the scroll's clamp moves everything.
  const left = wide.column.left
  const top = wide.column.top
  const name = wide.name
  const turns =
    name !== null &&
    Math.abs(name.height - line) <= SAME &&
    name.width <= geometry.nameMax
  // Turned about its top-left, the name's right edge lands on the strip
  // name's right edge, and its top on its top.
  const turn: Shift | null =
    turns && name !== null
      ? {
          dx: left + (geometry.width + line) / 2 - name.left,
          dy: top + geometry.nameTop - name.top,
        }
      : null
  const mark =
    scene.stripMark && wide.mark !== null
      ? {
          dx: left + (geometry.width - wide.mark.width) / 2 - wide.mark.left,
          dy: top + geometry.markTop - wide.mark.top,
        }
      : null
  const right = left + width
  const frames = Array.from({ length: SAMPLES + 1 }, (_, i): FoldFrame => {
    const offset = i / SAMPLES
    const eased = easeOut(offset)
    const fold = scene.unfolding ? 1 - eased : eased
    // Whatever turns stays left of the edge, or the clip would cut it and
    // the column after it, drawn above it, would cover it.
    const clearOf = [
      turn !== null && name !== null
        ? rightOf(name, 90 * fold, scaled(turn, fold))
        : -Infinity,
      mark !== null && wide.mark !== null
        ? rightOf(wide.mark, 0, scaled(mark, fold))
        : -Infinity,
    ]
    const limit = right - Math.max(...clearOf) - CLEAR
    return {
      offset,
      fold,
      inset: Math.max(0, Math.min(narrowing * fold, limit)),
    }
  })
  const shrunk = scene.scroll.width - narrowing
  const clamp = scene.unfolding
    ? 0
    : Math.max(0, scene.scroll.left - Math.max(0, shrunk - scene.scroll.client))
  const fade = scene.unfolding
    ? [
        { offset: 0, opacity: 0 },
        { offset: 0.4, opacity: 0 },
        { offset: 1, opacity: 1 },
      ]
    : [
        { offset: 0, opacity: 1 },
        { offset: 0.4, opacity: 0 },
        { offset: 1, opacity: 0 },
      ]
  return { duration: FOLD_MS, frames, turn, mark, fade, clamp }
}
