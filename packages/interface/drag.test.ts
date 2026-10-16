import { canvasIdFor, threadIdFor, workflowStateIdFor } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import {
  type Armed,
  type CanvasOver,
  type CanvasSource,
  type CardOver,
  type CardSource,
  type DragAt,
  type DragFrom,
  type DragSource,
  dragProps,
  dragVerdict,
  drawPlan,
  dropIntents,
  dropMark,
  hoverOpens,
  sidebarSpotAt,
  sourceOfElement,
} from "./drag.ts"
import type { IntentState } from "./effects.ts"
import { neighbourShifts } from "./reorder.ts"

const T = threadIdFor("t")
const K = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEXT = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const ARCHIVE = workflowStateIdFor("x")
const DOING = workflowStateIdFor("d")
const card: CardSource = { kind: "card", card: T }
const canvas: CanvasSource = {
  kind: "canvas",
  drag: { canvas: K, state: DOING },
}
const cardAt = (over: CardOver): DragAt => ({ ...card, over })
const overCanvas = (over: CanvasOver): DragAt => ({ ...canvas, over })
const from: DragFrom = { column: 1, home: null, archive: ARCHIVE }
/** A drag's verdict never reads the state for these: a canvas's, or one over the strip. */
const NO_STATE = {} as IntentState

const element = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})

test("a handle's source round-trips through its attributes; an element with none is no handle", () => {
  const stateless: DragSource = {
    kind: "canvas",
    drag: { canvas: K, state: null },
  }
  for (const s of [
    card,
    canvas,
    stateless,
    { kind: "card", card: cardIdFor("c") },
  ] as const)
    expect(sourceOfElement(element(dragProps(s)))).toEqual(s)
  expect(sourceOfElement(element({}))).toBeNull()
})

test("a column over the strip reorders, over its own gap moves nothing; a canvas lands by its own drop", () => {
  expect(
    dragVerdict(cardAt({ kind: "strip", gap: 3 }), from, "move", NO_STATE),
  ).toEqual({ kind: "reorder", to: 2 })
  expect(
    dragVerdict(cardAt({ kind: "strip", gap: 1 }), from, "move", NO_STATE),
  ).toEqual({ kind: "reorder", to: null })
  expect(
    dragVerdict(
      overCanvas({ kind: "root", target: { kind: "list", before: NEXT } }),
      from,
      "move",
      NO_STATE,
    ),
  ).toEqual({
    kind: "root",
    intent: { kind: "moveInList", canvas: K, before: NEXT },
  })
})

test("a drop sends what a key or a menu would: moveColumn, put or the canvas's drop, nothing else", () => {
  expect(dropIntents(card, { kind: "reorder", to: 2 }, "move")).toEqual([
    { kind: "moveColumn", column: { kind: "card", card: T }, to: 2 },
  ])
  const target = { kind: "item", canvas: K } as const
  expect(
    dropIntents(
      card,
      {
        kind: "land",
        target,
        landing: { kind: "move", card: T, to: target },
      },
      "copy",
    ),
  ).toEqual([
    { kind: "put", source: { kind: "card", card: T }, target, how: "copy" },
  ])
  expect(
    dropIntents(
      card,
      {
        kind: "land",
        target,
        landing: { kind: "refused", code: "no-place", card: T },
      },
      "move",
    ),
  ).toEqual([])
  expect(dropIntents(card, { kind: "reorder", to: null }, "move")).toEqual([])
})

test("held over a sidebar canvas it opens that canvas, over ▦ the board", () => {
  expect(hoverOpens({ kind: "canvas", canvas: K })).toEqual({
    kind: "show",
    here: { kind: "canvas", canvas: K },
  })
  expect(hoverOpens({ kind: "board" })).toMatchObject({
    kind: "board",
    open: true,
  })
  expect(hoverOpens({ kind: "none" })).toBeNull()
})

test("a sidebar row: between rows in its top and bottom quarters, onto its canvas in between", () => {
  const row = { top: 100, height: 40 }
  expect(sidebarSpotAt(105, row, K, NEXT)).toEqual({
    kind: "sidebar",
    before: K,
  })
  expect(sidebarSpotAt(120, row, K, NEXT)).toEqual({ kind: "item", canvas: K })
  expect(sidebarSpotAt(138, row, K, NEXT)).toEqual({
    kind: "sidebar",
    before: NEXT,
  })
  expect(sidebarSpotAt(138, row, K, null)).toEqual({
    kind: "sidebar",
    before: null,
  })
})

test("neighbours slide by the dragged column's width to open its gap, and the rest stay", () => {
  expect(neighbourShifts(1, 3, [100, 200, 100, 100])).toEqual([0, 0, -200, 0])
  expect(neighbourShifts(2, 0, [100, 100, 150, 100])).toEqual([150, 150, 0, 0])
  expect(neighbourShifts(1, 1, [100, 100, 100])).toEqual([0, 0, 0])
})

/** A column's drag, armed at its press: the strip's box, three columns. */
const armed: Armed = {
  start: { x: 100, y: 10 },
  column: true,
  strip: { left: 0, right: 1000, top: 0, bottom: 600 },
  from: 1,
  widths: [300, 300, 300],
}
/** A drag of anything but a column, armed at its press. */
const whole: Armed = {
  ...armed,
  column: false,
  strip: null,
  from: null,
  widths: [],
}

test("drawPlan: a column only translates, along the strip; off it, its face is drawn instead", () => {
  const on = drawPlan(
    armed,
    { x: 700, y: 40 },
    0,
    cardAt({ kind: "strip", gap: 3 }),
    { kind: "reorder", to: 2 },
    "move",
  )
  expect(on).toEqual({
    dragged: { x: 600, y: 0 },
    face: null,
    shifts: [0, 0, -300],
    mark: null,
    lean: 0,
    opens: { kind: "none" },
  })
  const off = drawPlan(
    armed,
    { x: 1200, y: 40 },
    100,
    cardAt({ kind: "none" }),
    { kind: "nothing" },
    "move",
  )
  expect([off.dragged, off.face, off.lean]).toEqual([
    null,
    { x: 1200, y: 40 },
    3,
  ])
  // Anything else moves whole, marked by what a drop there would do.
  const slot = { kind: "inventory", slot: 0 } as const
  const moved = drawPlan(
    whole,
    { x: 130, y: 50 },
    0,
    cardAt({ kind: "put", target: slot }),
    {
      kind: "land",
      target: slot,
      landing: {
        kind: "replace",
        old: T,
        landing: { kind: "move", card: T, to: { kind: "inventory", slot: 0 } },
      },
    },
    "move",
  )
  expect([moved.dragged, moved.face, moved.mark]).toEqual([
    { x: 30, y: 40 },
    null,
    "replace",
  ])
})

/** What a hold opens for `at`, drawn as a drag of anything but a column. */
const opensFor = (at: DragAt) =>
  drawPlan(whole, { x: 0, y: 0 }, 0, at, { kind: "nothing" }, "move").opens

test("a canvas's drag opens nothing, over a place among canvases or none", () => {
  expect(
    opensFor(
      overCanvas({ kind: "root", target: { kind: "list", before: NEXT } }),
    ),
  ).toEqual({ kind: "none" })
  expect(opensFor(overCanvas({ kind: "none" }))).toEqual({ kind: "none" })
})

test("a card's drag opens a sidebar canvas from its middle and ▦ the board; between canvases, nothing", () => {
  expect(
    opensFor(cardAt({ kind: "put", target: { kind: "item", canvas: K } })),
  ).toEqual({ kind: "canvas", canvas: K })
  expect(
    opensFor(cardAt({ kind: "put", target: { kind: "sidebar", before: K } })),
  ).toEqual({ kind: "none" })
  expect(opensFor(cardAt({ kind: "board" }))).toEqual({ kind: "board" })
  expect(opensFor(cardAt({ kind: "strip", gap: 0 }))).toEqual({
    kind: "none",
  })
})

test("a canvas's landing is marked as a root drop; a card's as its move or copy", () => {
  const intent = { kind: "moveInList", canvas: K, before: NEXT } as const
  expect(dropMark({ kind: "root", intent }, "move")).toBe("root")
  const target = { kind: "column", key: "k" } as const
  const land = {
    kind: "land",
    target,
    landing: { kind: "move", card: T, to: target },
  } as const
  expect(dropMark(land, "move")).toBe("move")
  expect(dropMark(land, "copy")).toBe("copy")
})
