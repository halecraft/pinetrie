import { taskIdFor, threadIdFor, workflowStateIdFor } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import {
  type Armed,
  type DragFrom,
  type DragSource,
  dragProps,
  dragVerdict,
  drawPlan,
  dropIntents,
  hoverOpens,
  sidebarSpotAt,
  sourceOfElement,
} from "./drag.ts"
import type { IntentState } from "./effects.ts"
import { neighbourShifts } from "./reorder.ts"

const T = threadIdFor("t")
const K = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEXT = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const ARCHIVE = workflowStateIdFor("x")
const DOING = workflowStateIdFor("d")
const card: DragSource = { kind: "card", card: T }
const task: DragSource = { kind: "task", drag: { task: K, state: DOING } }
const from: DragFrom = { column: 1, home: null, archive: ARCHIVE }
/** A drag's verdict never reads the state for these: a task's, or one over the strip. */
const NO_STATE = {} as IntentState

const element = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})

test("a handle's source round-trips through its attributes; an element with none is no handle", () => {
  const stateless: DragSource = { kind: "task", drag: { task: K, state: null } }
  for (const s of [
    card,
    task,
    stateless,
    { kind: "card", card: cardIdFor("c") },
  ] as const)
    expect(sourceOfElement(element(dragProps(s)))).toEqual(s)
  expect(sourceOfElement(element({}))).toBeNull()
})

test("a column over the strip reorders, over its own gap moves nothing; a task lands by its own drop", () => {
  expect(
    dragVerdict(card, from, { kind: "strip", gap: 3 }, "move", NO_STATE),
  ).toEqual({
    kind: "reorder",
    to: 2,
  })
  expect(
    dragVerdict(card, from, { kind: "strip", gap: 1 }, "move", NO_STATE),
  ).toEqual({
    kind: "reorder",
    to: null,
  })
  expect(
    dragVerdict(
      task,
      from,
      { kind: "root", target: { kind: "list", before: NEXT } },
      "move",
      NO_STATE,
    ),
  ).toEqual({
    kind: "root",
    intent: { kind: "moveInList", task: K, before: NEXT },
  })
  // A task over a card's drop zone, or a card over a task's, does nothing.
  expect(
    dragVerdict(
      task,
      from,
      { kind: "put", target: { kind: "inventory", slot: 0 } },
      "move",
      NO_STATE,
    ),
  ).toEqual({ kind: "nothing" })
  expect(
    dragVerdict(
      card,
      from,
      { kind: "root", target: { kind: "list", before: null } },
      "move",
      NO_STATE,
    ),
  ).toEqual({ kind: "nothing" })
})

test("a drop sends what a key or a menu would: moveColumn, put or the task's drop, nothing else", () => {
  expect(
    dropIntents(
      card,
      { kind: "strip", gap: 3 },
      { kind: "reorder", to: 2 },
      "move",
    ),
  ).toEqual([{ kind: "moveColumn", column: { kind: "card", card: T }, to: 2 }])
  const over = { kind: "put", target: { kind: "task", task: K } } as const
  expect(
    dropIntents(
      card,
      over,
      { kind: "land", landing: { kind: "move", card: T, to: over.target } },
      "copy",
    ),
  ).toEqual([
    {
      kind: "put",
      source: { kind: "card", card: T },
      target: over.target,
      how: "copy",
    },
  ])
  expect(
    dropIntents(
      card,
      over,
      { kind: "land", landing: { kind: "refused", code: "no-place", card: T } },
      "move",
    ),
  ).toEqual([])
  expect(
    dropIntents(card, over, { kind: "reorder", to: null }, "move"),
  ).toEqual([])
})

test("held over a sidebar task it opens that task, over ▦ the board", () => {
  expect(hoverOpens({ kind: "task", task: K })).toEqual({
    kind: "show",
    here: { kind: "task", task: K },
  })
  expect(hoverOpens({ kind: "board" })).toMatchObject({
    kind: "board",
    open: true,
  })
  expect(hoverOpens({ kind: "none" })).toBeNull()
})

test("a sidebar row: between rows in its top and bottom quarters, onto its task in between", () => {
  const row = { top: 100, height: 40 }
  expect(sidebarSpotAt(105, row, K, NEXT)).toEqual({
    kind: "sidebar",
    before: K,
  })
  expect(sidebarSpotAt(120, row, K, NEXT)).toEqual({ kind: "task", task: K })
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

test("drawPlan: a column only translates, along the strip; off it, its face is drawn instead", () => {
  const armed: Armed = {
    start: { x: 100, y: 10 },
    column: true,
    strip: { left: 0, right: 1000, top: 0, bottom: 600 },
    from: 1,
    widths: [300, 300, 300],
  }
  const over = { kind: "strip", gap: 3 } as const
  const on = drawPlan(
    armed,
    { x: 700, y: 40 },
    0,
    over,
    { kind: "reorder", to: 2 },
    "move",
  )
  expect(on).toEqual({
    dragged: { x: 600, y: 0 },
    face: null,
    shifts: [0, 0, -300],
    mark: null,
    lean: 0,
  })
  const off = drawPlan(
    armed,
    { x: 1200, y: 40 },
    100,
    { kind: "none" },
    { kind: "nothing" },
    "move",
  )
  expect([off.dragged, off.face, off.lean]).toEqual([
    null,
    { x: 1200, y: 40 },
    3,
  ])
  // Anything else moves whole, marked by what a drop there would do.
  const whole = drawPlan(
    { ...armed, column: false, strip: null, from: null, widths: [] },
    { x: 130, y: 50 },
    0,
    { kind: "put", target: { kind: "inventory", slot: 0 } },
    {
      kind: "land",
      landing: {
        kind: "replace",
        old: T,
        landing: { kind: "move", card: T, to: { kind: "inventory", slot: 0 } },
      },
    },
    "move",
  )
  expect([whole.dragged, whole.face, whole.mark]).toEqual([
    { x: 30, y: 40 },
    null,
    "replace",
  ])
})
