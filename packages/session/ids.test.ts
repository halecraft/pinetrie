import { parseNewLane } from "@pinetrie/core"
import { expect, test } from "vitest"
import { newLaneName } from "./ids.ts"

test("every lane id this client mints is one the host accepts (ADR-0057)", () => {
  for (let i = 0; i < 1_000; i += 1) {
    const lane = newLaneName()
    expect(parseNewLane(lane)).toBe(lane)
  }
})
