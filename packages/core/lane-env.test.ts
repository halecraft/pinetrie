import { expect, test } from "vitest"
import { hostPathInLane } from "./lane-env.ts"

test("hostPathInLane: a granted host path sits under /mnt/host at its own path", () => {
  expect(hostPathInLane("/Users/ada/skills/plan")).toBe(
    "/mnt/host/Users/ada/skills/plan",
  )
})
