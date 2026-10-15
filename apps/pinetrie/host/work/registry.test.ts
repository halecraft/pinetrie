import {
  type ForeignLane,
  type ProjectKind,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { LaneHistory, LaneRuntime } from "@pinetrie/lanes"
import { foreignLaneWords, LANE, setRecord } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { basics, putValue, record } from "../fakes.ts"
import { createRegistry } from "./registry.ts"

const LANE_ID = threadIdFor("1")

/** A registry whose lane `LANE_ID` keeps `history`, over `adapter`. */
function registryWith(
  history: ProjectKind | null | "none",
  adapter: () => LaneHistory | ForeignLane,
) {
  const b = basics()
  if (history !== "none")
    putValue(
      b,
      setRecord(LANE, {
        lane: LANE_ID,
        root: rootIdFor("r"),
        history,
        by: writerId("ada@x.io"),
        createdAt: 0,
      }),
    )
  const asked: unknown[] = []
  const registry = createRegistry({
    session: b.session,
    runtime: record<LaneRuntime>().port,
    history: lane => {
      asked.push(lane)
      return adapter()
    },
  })
  return { registry, asked }
}

test("a lane's history is reached on its queue: a second step waits for the first", async () => {
  const history = record<LaneHistory>().port
  const { registry } = registryWith("jj", () => history)
  const seen: string[] = []
  const first = Promise.withResolvers<void>()
  const one = registry.withHistory(LANE_ID, async h => {
    expect(h).toBe(history)
    seen.push("first starts")
    await first.promise
    seen.push("first ends")
  })
  const two = registry.withHistory(LANE_ID, async () => {
    seen.push("second starts")
  })
  await new Promise(r => setTimeout(r, 0))
  expect(seen).toEqual(["first starts"])
  first.resolve()
  await Promise.all([one, two])
  expect(seen).toEqual(["first starts", "first ends", "second starts"])
})

describe("withHistory refuses a lane it cannot prove, and runs nothing on it", () => {
  test("a lane the adapter refuses fails with its words", async () => {
    const foreign: ForeignLane = {
      kind: "foreign",
      lane: LANE_ID,
      history: "folder",
    }
    const { registry } = registryWith("folder", () => foreign)
    let ran = false
    await expect(
      registry.withHistory(
        LANE_ID,
        async () => {
          ran = true
        },
        { fatal: true },
      ),
    ).rejects.toThrow(foreignLaneWords(foreign))
    expect(ran).toBe(false)
  })

  test("a lane with no copy of its own, or no record, is refused before the adapter is asked", async () => {
    for (const history of [null, "none"] as const) {
      const { registry, asked } = registryWith(
        history,
        () => record<LaneHistory>().port,
      )
      await expect(
        registry.withHistory(LANE_ID, async () => {}),
      ).rejects.toThrow(
        history === null ? "has no copy of its own" : "has no lane record",
      )
      expect(asked).toEqual([])
    }
  })
})
