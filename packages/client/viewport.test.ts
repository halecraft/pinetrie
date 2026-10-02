import { expect, test } from "vitest"
import {
  keepSpot,
  placeAt,
  RAIL_HOLD_MS,
  RAIL_MARGIN,
  railScroll,
  sameSpan,
  spotFor,
  spotOf,
  visibleSpan,
} from "./viewport.ts"

// Three 100 px messages, the view 150 px tall, scrolled 50 px into the first.
const boxes = [
  { id: "a", top: -50, bottom: 50 },
  { id: "b", top: 50, bottom: 150 },
  { id: "c", top: 150, bottom: 250 },
]

test("visibleSpan: the messages at the view's top and bottom, and how far into each", () => {
  expect(visibleSpan(boxes, 150)).toEqual({
    first: { id: "a", at: 0.5 },
    last: { id: "b", at: 1 },
  })
  expect(visibleSpan(boxes, 175)).toEqual({
    first: { id: "a", at: 0.5 },
    last: { id: "c", at: 0.25 },
  })
  expect(visibleSpan([], 100)).toBeNull()
})

test("visibleSpan: a top in a gap is past the message above it; content short of the bottom ends at the last", () => {
  // A fold's line between a and b, from 0 to 20.
  const gap = [
    { id: "a", top: -100, bottom: 0 },
    { id: "b", top: 20, bottom: 120 },
  ]
  expect(visibleSpan(gap, 500)).toEqual({
    first: { id: "a", at: 1 },
    last: { id: "b", at: 1 },
  })
  // Everything below the top: the first message, from its start.
  expect(visibleSpan([{ id: "a", top: 30, bottom: 60 }], 500)).toEqual({
    first: { id: "a", at: 0 },
    last: { id: "a", at: 1 },
  })
})

test("visibleSpan agrees with a scan, over many boxes and views", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    top: i * 30 - 400,
    bottom: i * 30 - 400 + 25,
  }))
  for (const height of [10, 100, 333, 900]) {
    const span = visibleSpan(many, height)
    const top = many.filter(b => b.top <= 0).at(-1) ?? many[0]
    const bottom = many.find(b => b.bottom >= height) ?? many.at(-1)
    expect(span?.first.id).toBe(top?.id)
    expect(span?.last.id).toBe(bottom?.id)
  }
})

test("sameSpan: a change under 1% of a message is the same", () => {
  const span = visibleSpan(boxes, 150)
  expect(sameSpan(span, visibleSpan(boxes, 149.5))).toBe(true)
  expect(sameSpan(span, visibleSpan(boxes, 175))).toBe(false)
  expect(sameSpan(null, span)).toBe(false)
})

test("spotOf: following leaves the end, at the last message; else the view's top", () => {
  const span = visibleSpan(boxes, 150)
  expect(spotOf(span, true, "c")).toEqual({ kind: "end", id: "c" })
  expect(spotOf(span, false, "c")).toEqual({ kind: "at", id: "a", at: 0.5 })
  expect(spotOf(null, false, "c")).toBeNull()
})

test("keepSpot: one spot per column, at a message it shows", () => {
  let spots = keepSpot(new Map(), ["a", "b"], { kind: "at", id: "b", at: 0 })
  spots = keepSpot(spots, ["x", "y"], { kind: "end", id: "y" })
  // The first column again: its old spot goes.
  spots = keepSpot(spots, ["a", "b", "c"], { kind: "at", id: "a", at: 0.2 })
  expect([...spots.keys()].sort()).toEqual(["a", "y"])
  expect(spotFor(spots, ["c", "b", "a"])).toEqual({
    kind: "at",
    id: "a",
    at: 0.2,
  })
  expect(spotFor(spots, ["q"])).toBeUndefined()
  // No spot, or one at a message it does not show: the column keeps none.
  expect(keepSpot(spots, ["a"], null).has("a")).toBe(false)
  expect(keepSpot(spots, ["a"], { kind: "end", id: "z" }).has("z")).toBe(false)
})

test("placeAt: as far into the message as the view's top was; an end at the bottom", () => {
  const m = {
    top: 400,
    bottom: 600,
    scrollHeight: 2000,
    clientHeight: 500,
    lastId: "z",
  }
  expect(placeAt({ kind: "at", id: "a", at: 0.25 }, m)).toBe(450)
  // Its old end, with more below it now: that message's bottom at the view's bottom.
  expect(placeAt({ kind: "end", id: "a" }, m)).toBe(100)
  // Still the last message: the column's end.
  expect(placeAt({ kind: "end", id: "z" }, m)).toBe(1500)
  // Clamped to what can scroll.
  expect(placeAt({ kind: "at", id: "a", at: 0 }, { ...m, top: 1900 })).toBe(
    1500,
  )
  // Content that fits its view is left to alignment.
  expect(
    placeAt({ kind: "at", id: "a", at: 0 }, { ...m, scrollHeight: 500 }),
  ).toBeNull()
})

test("railScroll: brings a band into view, unless the reader just scrolled the rail", () => {
  const view = { scrollTop: 0, clientHeight: 300, scrollHeight: 1000 }
  const still = RAIL_HOLD_MS
  expect(railScroll({ top: 100, bottom: 200 }, view, still)).toBeNull()
  // Below: its bottom comes up to the view's, with the margin.
  expect(railScroll({ top: 400, bottom: 500 }, view, still)).toBe(
    500 + RAIL_MARGIN - 300,
  )
  // Above: its top goes down to the view's.
  expect(
    railScroll({ top: 100, bottom: 150 }, { ...view, scrollTop: 600 }, still),
  ).toBe(100 - RAIL_MARGIN)
  // Taller than the view: its top.
  expect(railScroll({ top: 400, bottom: 900 }, view, still)).toBe(
    400 - RAIL_MARGIN,
  )
  // The reader scrolled the rail a moment ago.
  expect(railScroll({ top: 400, bottom: 500 }, view, still - 1)).toBeNull()
})
