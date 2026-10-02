import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import {
  type BandItem,
  pickAt,
  railBands,
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

test("railBands: dots whole, a capsule cut where the view's edges are, one band per track", () => {
  const itemOf = new Map<string, BandItem>()
  const add = (item: BandItem) => {
    for (const id of item.ids) itemOf.set(id, item)
  }
  add({ slot: 0, span: 1, track: 0, ids: ["r"] })
  // Ten messages in a capsule three slots long.
  const run = Array.from({ length: 10 }, (_, i) => `s${i}`)
  add({ slot: 1, span: 3, track: 0, ids: run })
  add({ slot: 4, span: 1, track: 0, ids: ["t"] })
  add({ slot: 5, span: 1, track: 1, ids: ["b"] })
  // From halfway into s2 to a quarter into s7: within the capsule alone.
  expect(railBands(itemOf, run.slice(2, 8), 0.5, 0.25)).toEqual([
    { track: 0, top: 0.5 + 0.3 * 2.5, bottom: 0.5 + 0.3 * 7.25 },
  ])
  // A dot is whole, wherever the edges are in it.
  expect(railBands(itemOf, ["r"], 0.9, 0.1)).toEqual([
    { track: 0, top: -0.5, bottom: 0.5 },
  ])
  // Onto a branch's track: a band of its own. An id the rail lacks is skipped.
  expect(railBands(itemOf, ["s9", "t", "nope", "b"], 0, 1)).toEqual([
    { track: 0, top: 0.5 + 0.3 * 9, bottom: 4.5 },
    { track: 1, top: 4.5, bottom: 5.5 },
  ])
})
