import { cardIdOfKind } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { imageSpot } from "./image-edge.ts"

const image = (n: number) =>
  cardIdOfKind("image", `01a0ffd2-0000-7000-8000-00000000000${n}`)

describe("an image's edges", () => {
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
