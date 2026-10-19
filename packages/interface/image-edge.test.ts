import { cardIdOfKind } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { EDGE_BAND_PX, imageEdge, imageSpot } from "./image-edge.ts"

const box = { left: 0, top: 100, width: 400, height: 600 }
const image = (n: number) =>
  cardIdOfKind("image", `01a0ffd2-0000-7000-8000-00000000000${n}`)

describe("an image's edges", () => {
  test("a tall image keeps all but a fixed band at each edge for versions", () => {
    expect(imageEdge({ x: 200, y: 100 + EDGE_BAND_PX - 1 }, box, false)).toBe(
      "before",
    )
    expect(imageEdge({ x: 200, y: 100 + EDGE_BAND_PX + 1 }, box, false)).toBe(
      "onto",
    )
    expect(imageEdge({ x: 200, y: 700 - EDGE_BAND_PX + 1 }, box, false)).toBe(
      "after",
    )
  })

  test("a small image's band is a quarter of it", () => {
    const small = { left: 0, top: 0, width: 40, height: 40 }
    expect(imageEdge({ x: 20, y: 9 }, small, false)).toBe("before")
    expect(imageEdge({ x: 20, y: 11 }, small, false)).toBe("onto")
  })

  test("two to a row, its edges are left and right", () => {
    expect(imageEdge({ x: 5, y: 400 }, box, true)).toBe("before")
    expect(imageEdge({ x: 398, y: 400 }, box, true)).toBe("after")
    expect(imageEdge({ x: 200, y: 101 }, box, true)).toBe("onto")
  })

  test("before an image is just before it; after it, just before the next, or the end", () => {
    const order = [image(1), image(2)]
    expect(imageSpot(image(2), "before", order)).toEqual({
      kind: "spot",
      before: image(2),
    })
    expect(imageSpot(image(1), "after", order)).toEqual({
      kind: "spot",
      before: image(2),
    })
    expect(imageSpot(image(2), "after", order)).toEqual({
      kind: "spot",
      before: null,
    })
    expect(imageSpot(image(1), "onto", order)).toEqual({
      kind: "version",
      image: image(1),
    })
  })
})
