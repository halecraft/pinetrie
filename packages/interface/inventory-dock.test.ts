import { expect, test } from "vitest"
import { dockCodec, snapTo } from "./inventory-dock.ts"

test("snapTo: the nearest third", () => {
  expect(snapTo(10, 900)).toBe("left")
  expect(snapTo(299, 900)).toBe("left")
  expect(snapTo(300, 900)).toBe("centre")
  expect(snapTo(599, 900)).toBe("centre")
  expect(snapTo(600, 900)).toBe("right")
  expect(dockCodec.decode("right")).toBe("right")
  expect(dockCodec.decode("top")).toBeUndefined()
})
