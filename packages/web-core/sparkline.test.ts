import { expect, test } from "vitest"
import { sparkPath } from "./sparkline.ts"

test("a minute with nothing read breaks the line, and a point alone is a dot", () => {
  expect(sparkPath([0, 0.5, null, 1, 1, null, 0.25], 60, 10)).toEqual({
    runs: [
      { d: "M0 10L10 5", from: 0 },
      { d: "M30 0L40 0", from: 30 },
    ],
    dots: [{ x: 60, y: 7.5 }],
  })
})
