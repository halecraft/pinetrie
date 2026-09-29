import { expect, test } from "vitest"
import { placement } from "./align.ts"

test("with no fork point on screen, or no first message, a column opens at its end", () => {
  expect(placement({ fork: null, first: 12 })).toEqual({ kind: "end" })
  expect(placement({ fork: { top: 100, shownTo: 400 }, first: null })).toEqual({
    kind: "end",
  })
})

test("a fork point below its column's view is no fork point: no spacer reaches it", () => {
  expect(placement({ fork: { top: 3153, shownTo: 445 }, first: 12 })).toEqual({
    kind: "end",
  })
  expect(placement({ fork: { top: 445, shownTo: 445 }, first: 12 })).toEqual({
    kind: "end",
  })
})

test("a fork point in view and lower than the first message grows the spacer", () => {
  expect(placement({ fork: { top: 300, shownTo: 445 }, first: 12 })).toEqual({
    kind: "level",
    spacer: 288,
    scrollTop: 0,
  })
})

test("a fork point higher than the first message, even above its view, is met by scrolling", () => {
  expect(placement({ fork: { top: 40, shownTo: 445 }, first: 500 })).toEqual({
    kind: "level",
    spacer: 0,
    scrollTop: 460,
  })
  expect(placement({ fork: { top: -200, shownTo: 445 }, first: 12 })).toEqual({
    kind: "level",
    spacer: 0,
    scrollTop: 212,
  })
})
