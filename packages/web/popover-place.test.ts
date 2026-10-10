import { expect, test } from "vitest"
import { EDGE, placeBox } from "./popover-place.ts"

const view = { width: 1000, height: 800 }
const at = (left: number, top: number) => ({
  left,
  right: left + 20,
  top,
  bottom: top + 20,
})

test.each([
  [
    "below and leftwards from the top right",
    at(900, 100),
    { top: 120, right: 80, maxHeight: 800 - 120 - EDGE },
  ],
  [
    "below and rightwards from the top left",
    at(50, 100),
    { top: 120, left: 50, maxHeight: 800 - 120 - EDGE },
  ],
  [
    "above and leftwards from the bottom right",
    at(900, 700),
    { bottom: 100, right: 80, maxHeight: 700 - EDGE },
  ],
  [
    "above and rightwards from the bottom left",
    at(50, 700),
    { bottom: 100, left: 50, maxHeight: 700 - EDGE },
  ],
])("a box opens %s, as tall as the room on that side", (_, trigger, placed) => {
  expect(placeBox(trigger, view)).toEqual(placed)
})
