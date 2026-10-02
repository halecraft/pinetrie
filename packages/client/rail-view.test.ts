import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import {
  pickAt,
  railItems,
  railKeep,
  stretchFill,
  stretchWords,
} from "./rail-view.ts"

test("railKeep: rings, running tips, open columns' ends and your cards' ends", () => {
  const keep = railKeep({
    rings: new Map([["r", []]]),
    activity: [{ lane: laneNameForThread("s"), tip: "t" }],
    ends: ["e", null],
    cards: new Set(["c"]),
  })
  expect([...keep].sort()).toEqual(["c", "e", "r", "t"])
})

test("stretchWords: a long ask's capsule leads with its ask", () => {
  expect(stretchWords('Ada: "Fix the rail"', "31 steps")).toBe(
    'Ada: "Fix the rail" · 31 steps',
  )
  expect(stretchWords(null, "4 messages from Bea")).toBe("4 messages from Bea")
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

test("stretchFill: the agent alone, people alone, or both", () => {
  const stats = (people: number, agent: number) => ({
    people,
    agent,
    writers: [],
    calls: 0,
    failed: 0,
    files: [],
    first: 0,
    last: 0,
  })
  expect(stretchFill(stats(0, 12))).toBe("agent")
  expect(stretchFill(stats(1, 11))).toBe("mixed")
  expect(stretchFill(stats(11, 1))).toBe("mixed")
  expect(stretchFill(stats(12, 0))).toBe("people")
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
