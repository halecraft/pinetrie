import { threadIdFor } from "@pinetrie/core"
import type { LaneHistory, LaneRuntime } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import { createRegistry } from "./registry.ts"

const LANE = threadIdFor("1")

test("a lane's history is reached on its queue: a second step waits for the first", async () => {
  const history = record<LaneHistory>().port
  const registry = createRegistry({
    session: basics().session,
    runtime: record<LaneRuntime>().port,
    history: () => history,
  })
  const seen: string[] = []
  const first = Promise.withResolvers<void>()
  const one = registry.withHistory(LANE, async h => {
    expect(h).toBe(history)
    seen.push("first starts")
    await first.promise
    seen.push("first ends")
  })
  const two = registry.withHistory(LANE, async () => {
    seen.push("second starts")
  })
  await new Promise(r => setTimeout(r, 0))
  expect(seen).toEqual(["first starts"])
  first.resolve()
  await Promise.all([one, two])
  expect(seen).toEqual(["first starts", "first ends", "second starts"])
})
