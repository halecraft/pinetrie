import { laneNameForThread, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { pickAt, railItems, railKeep, runFill, runLabel } from "./rail-view.ts"

test("railKeep: rings, running tips, open columns' ends and your cards' ends", () => {
  const keep = railKeep({
    rings: new Map([["r", []]]),
    activity: [{ lane: laneNameForThread("s"), tip: "t" }],
    ends: ["e", null],
    cards: new Set(["c"]),
  })
  expect([...keep].sort()).toEqual(["c", "e", "r", "t"])
})

test("runLabel: each part that is not zero, people named", () => {
  const ada = writerId("w-ada")
  const bea = writerId("w-bea")
  const name = (w: string) => (w === ada ? "Ada" : "Bea")
  expect(
    runLabel(
      155,
      { people: 12, writers: [ada, bea], calls: 211, failed: 2 },
      name,
    ),
  ).toBe(
    "12 messages from Ada and Bea · 143 agent messages · 211 tool calls · 2 failed",
  )
  expect(
    runLabel(3, { people: 0, writers: [], calls: 1, failed: 0 }, name),
  ).toBe("3 agent messages · 1 tool call")
  expect(
    runLabel(4, { people: 4, writers: [bea], calls: 0, failed: 0 }, name),
  ).toBe("4 messages from Bea")
})

test("pickAt: the message as far through the run as the click is down it", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const
  expect(pickAt(ids, 0)).toBe("a")
  expect(pickAt(ids, 0.55)).toBe("f")
  expect(pickAt(ids, 0.999)).toBe("j")
  // The edges of the border can measure just outside.
  expect([pickAt(ids, -0.01), pickAt(ids, 1)]).toEqual(["a", "j"])
  expect(pickAt(ids, null)).toBe("a")
})

test("runFill: the agent alone, people alone, or both", () => {
  const stats = (people: number) => ({
    people,
    writers: [],
    calls: 0,
    failed: 0,
  })
  expect(runFill(12, stats(0))).toBe("agent")
  expect(runFill(12, stats(1))).toBe("mixed")
  expect(runFill(12, stats(11))).toBe("mixed")
  expect(runFill(12, stats(12))).toBe("people")
})

test("railItems: a dot at a thread end holding your card carries your colour", () => {
  const item = (id: string) => ({ ids: [id, `${id}-later`] })
  const marks = railItems([item("c"), item("o")], {
    open: new Set(["o"]),
    yours: { ends: new Set(["c"]), color: "#f0f" },
  }).map(([, m]) => m)
  expect(marks).toEqual([
    { open: false, yours: "#f0f" },
    { open: true, yours: null },
  ])
})
