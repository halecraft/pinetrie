import { expect, test } from "vitest"
import { dockCodec, snappedDock } from "./inventory-dock.ts"

test("snappedDock: the nearest third", () => {
  expect(snappedDock(10, 900)).toBe("left")
  expect(snappedDock(299, 900)).toBe("left")
  expect(snappedDock(300, 900)).toBe("centre")
  expect(snappedDock(599, 900)).toBe("centre")
  expect(snappedDock(600, 900)).toBe("right")
  expect(dockCodec.decode("right")).toBe("right")
  expect(dockCodec.decode("top")).toBeUndefined()
})
