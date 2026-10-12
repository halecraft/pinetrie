import { PICTURE_MOST } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  cropSource,
  fitCrop,
  MOST_ZOOM,
  moveCrop,
  PICTURE_SIZE,
  zoomCrop,
} from "./picture-crop.ts"

const WIDE = { width: 1200, height: 800 }

test("the browser's picture is never one the host must fit", () => {
  expect(PICTURE_SIZE).toBeLessThanOrEqual(PICTURE_MOST)
})

describe("a picture's crop", () => {
  test("it starts as the largest square, centred", () => {
    expect(cropSource(fitCrop(WIDE), WIDE)).toEqual({
      sx: 200,
      sy: 0,
      side: 800,
    })
  })

  test("a drag moves the square against the pointer, and stops at the image's edge", () => {
    const start = fitCrop(WIDE)
    // 100 px of a 400 px preview is a quarter of the 800 px square.
    expect(cropSource(moveCrop(start, 100, 0, WIDE, 400), WIDE).sx).toBe(0)
    expect(cropSource(moveCrop(start, -100, 0, WIDE, 400), WIDE).sx).toBe(400)
    const far = moveCrop(start, -10_000, -10_000, WIDE, 400)
    expect(cropSource(far, WIDE)).toEqual({ sx: 400, sy: 0, side: 800 })
  })

  test("zooming halves the side at 2, stays between 1 and the most, and keeps the square inside", () => {
    const start = fitCrop(WIDE)
    expect(cropSource(zoomCrop(start, 2, WIDE), WIDE)).toEqual({
      sx: 400,
      sy: 200,
      side: 400,
    })
    expect(zoomCrop(start, 99, WIDE).zoom).toBe(MOST_ZOOM)
    expect(zoomCrop(start, 0.1, WIDE).zoom).toBe(1)
    // Zoomed in at a corner, then out: the bigger square is pushed back inside.
    const corner = moveCrop(zoomCrop(start, 4, WIDE), 10_000, 10_000, WIDE, 400)
    const out = cropSource(zoomCrop(corner, 1, WIDE), WIDE)
    expect(out.sx).toBeGreaterThanOrEqual(0)
    expect(out.sy).toBe(0)
    expect(out.sx + out.side).toBeLessThanOrEqual(WIDE.width)
  })
})
