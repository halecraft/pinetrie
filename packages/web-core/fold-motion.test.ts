import { describe, expect, test } from "vitest"
import {
  type FoldMotion,
  type FoldScene,
  planFoldMotion,
  type Rect,
} from "./fold-motion.ts"

// A thread's column as the page draws it at 1400 × 800: its boxes, and its
// strip's geometry, measured in Chromium.
const column: Rect = { left: 324.19, top: 0, width: 449, height: 758 }
const name: Rect = { left: 364.98, top: 11.86, width: 80.11, height: 21.06 }
const mark: Rect = { left: 336.19, top: 10.39, width: 24, height: 24 }
// Where the strip, once drawn, put its name and mark.
const stripName: Rect = {
  left: 331.25,
  top: 92.78,
  width: 21.06,
  height: 80.11,
}
const stripMark: Rect = { left: 329.78, top: 62.39, width: 24, height: 24 }
// The header's toggle, first, centred in the strip's width from the column's
// left edge; its box after it.
const toggle: Rect = { left: 324.19, top: 10.39, width: 35.2, height: 24 }
const box: Rect = { left: 362.59, top: 15.59, width: 13.6, height: 13.6 }
const wide = { column, name, mark, toggle, box }

const scene = (over: Partial<FoldScene> = {}): FoldScene => ({
  unfolding: false,
  wide,
  stripMark: true,
  stripBox: true,
  geometry: {
    width: 35.2,
    markTop: 62.4,
    nameTop: 92.8,
    nameMax: 480,
    toggleTop: 4,
    toggleHeight: 36.8,
    boxTop: 40.8,
    boxHeight: 16,
  },
  line: 21.06,
  view: { left: 0, top: 0, width: 1400, height: 800 },
  scroll: { left: 0, width: 1400, client: 1076 },
  reducedMotion: false,
  dragging: false,
  ...over,
})

const plan = (over: Partial<FoldScene> = {}): FoldMotion => {
  const motion = planFoldMotion(scene(over))
  if (motion === null) throw new Error("no motion")
  return motion
}

/** `box` turned `deg` clockwise about its top-left and moved: its corners' bounds. */
function turned(box: Rect, deg: number, dx: number, dy: number): Rect {
  const a = (deg * Math.PI) / 180
  const pts = [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ].map(([x = 0, y = 0]) => [
    box.left + dx + x * Math.cos(a) - y * Math.sin(a),
    box.top + dy + x * Math.sin(a) + y * Math.cos(a),
  ])
  const xs = pts.map(p => p[0] ?? 0)
  const ys = pts.map(p => p[1] ?? 0)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  }
}

const near = (a: Rect, b: Rect) => {
  expect(a.left).toBeCloseTo(b.left, 1)
  expect(a.top).toBeCloseTo(b.top, 1)
  expect(a.width).toBeCloseTo(b.width, 1)
  expect(a.height).toBeCloseTo(b.height, 1)
}

describe("planFoldMotion", () => {
  test("a fold turns the name onto where its strip draws it", () => {
    const { turn } = plan()
    if (turn === null) throw new Error("no turn")
    near(turned(name, 90, turn.dx, turn.dy), stripName)
  })

  test("a fold moves the mark onto its strip's, unturned", () => {
    const { mark: by } = plan()
    if (by === null) throw new Error("no mark")
    near({ ...mark, left: mark.left + by.dx, top: mark.top + by.dy }, stripMark)
  })

  test("a fold moves the toggle onto its strip's, centre on centre, where it already stands", () => {
    const { toggle: by } = plan()
    if (by === null) throw new Error("no toggle")
    // The strip's toggle row: from its top border to its head's foot.
    expect(toggle.left + toggle.width / 2 + by.dx).toBeCloseTo(
      column.left + 35.2 / 2,
      5,
    )
    expect(toggle.top + toggle.height / 2 + by.dy).toBeCloseTo(4 + 36.8 / 2, 5)
    // The header's toggle is where the strip's is, so it hardly moves.
    expect(Math.abs(by.dx)).toBeLessThan(1)
    expect(Math.abs(by.dy)).toBeLessThan(1)
  })

  test("a fold moves the box into its strip row, under the toggle; a strip with none fades it", () => {
    const { box: by } = plan()
    if (by === null) throw new Error("no box")
    expect(box.left + box.width / 2 + by.dx).toBeCloseTo(
      column.left + 35.2 / 2,
      5,
    )
    expect(box.top + box.height / 2 + by.dy).toBeCloseTo(40.8 + 16 / 2, 5)
    expect(plan({ stripBox: false }).box).toBeNull()
    expect(plan({ wide: { ...wide, box: null } }).box).toBeNull()
    expect(plan({ wide: { ...wide, toggle: null } }).toggle).toBeNull()
  })

  test("an unfold starts where a fold ends, and ends wide", () => {
    const fold = plan()
    const unfold = plan({ unfolding: true })
    expect(unfold.turn).toEqual(fold.turn)
    expect(unfold.mark).toEqual(fold.mark)
    expect(unfold.toggle).toEqual(fold.toggle)
    expect(unfold.box).toEqual(fold.box)
    expect(unfold.frames[0]).toEqual({ offset: 0, fold: 1, inset: 449 - 35.2 })
    expect(fold.frames.at(-1)).toEqual({
      offset: 1,
      fold: 1,
      inset: 449 - 35.2,
    })
    expect(unfold.frames.at(-1)).toEqual({ offset: 1, fold: 0, inset: 0 })
    expect(unfold.fade.map(f => f.opacity)).toEqual([0, 0, 1])
    expect(fold.fade.map(f => f.opacity)).toEqual([1, 0, 0])
  })

  test("the edge stays clear of a long name all the way through its turn", () => {
    const long = { ...name, width: 320 }
    const motion = plan({ wide: { ...wide, name: long } })
    const { turn } = motion
    if (turn === null) throw new Error("no turn")
    const edges = motion.frames.map(f => {
      const at = turned(long, 90 * f.fold, turn.dx * f.fold, turn.dy * f.fold)
      return column.left + column.width - f.inset - (at.left + at.width)
    })
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(2 - 1e-9)
    // Unclamped, the edge would have run through it.
    const eased = motion.frames.map(f => (column.width - 35.2) * f.fold)
    expect(motion.frames.some((f, i) => f.inset < (eased[i] ?? 0))).toBe(true)
  })

  test("nothing moves under reduced motion, during a drag, out of view, or already narrow", () => {
    expect(planFoldMotion(scene({ reducedMotion: true }))).toBeNull()
    expect(planFoldMotion(scene({ dragging: true }))).toBeNull()
    expect(
      planFoldMotion(
        scene({ view: { left: 900, top: 0, width: 500, height: 800 } }),
      ),
    ).toBeNull()
    expect(
      planFoldMotion(
        scene({ wide: { ...wide, column: { ...column, width: 35.2 } } }),
      ),
    ).toBeNull()
  })

  test("a name that wraps, outgrows the strip or is another size fades instead of turning", () => {
    const wraps = { ...name, height: 42.12 }
    expect(plan({ wide: { ...wide, name: wraps } }).turn).toBeNull()
    expect(
      plan({ geometry: { ...scene().geometry, nameMax: 60 } }).turn,
    ).toBeNull()
    expect(plan({ line: 19.84 }).turn).toBeNull()
    expect(plan({ wide: { ...wide, name: null } }).turn).toBeNull()
    expect(plan({ stripMark: false }).mark).toBeNull()
  })

  test("a fold that shrinks the scroll below where it stands moves every column by the clamp", () => {
    const scroll = { left: 900, width: 2000, client: 1000 }
    // The strip's scroll shrinks by 413.8 px, to 1586.2: the most it can
    // stand at is 586.2.
    expect(plan({ scroll }).clamp).toBeCloseTo(900 - 586.2, 5)
    expect(plan({ scroll: { ...scroll, left: 100 } }).clamp).toBe(0)
    expect(plan({ scroll, unfolding: true }).clamp).toBe(0)
  })
})
