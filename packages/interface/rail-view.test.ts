import { entryId } from "@pinetrie/core"
import { indexTree } from "@pinetrie/threads"
import {
  entriesById,
  entry,
  personMessage,
  toolResultMessage,
} from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  capsulePick,
  railItems,
  railKeep,
  railRings,
  railSpots,
  railView,
  stretchFill,
  stretchWords,
  type ViewItem,
} from "./rail-view.ts"

test("railKeep: rings, running tips, open columns' ends and your cards' ends", () => {
  const keep = railKeep({
    rings: new Map([[entryId("r"), []]]),
    pulses: new Set([entryId("t")]),
    ends: new Set([entryId("e")]),
    cards: new Set([entryId("c")]),
  })
  expect([...keep].sort()).toEqual(["c", "e", "r", "t"])
})

describe("the dots that carry rail marks", () => {
  const index = indexTree(
    entriesById([
      entry("1-c", null, undefined, { type: "compaction" }),
      entry("2-p", "1-c", personMessage("p", { author: "A" })),
      entry("3-a", "2-p", {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
      }),
      entry("4-r", "3-a", toolResultMessage()),
    ]),
  )
  const id = entryId

  test("railSpots: a tool's result is marked at its call, a message at itself", () => {
    expect([...railSpots(index, [id("4-r"), id("2-p"), null])]).toEqual([
      "3-a",
      "2-p",
    ])
  })

  test("railSpots: an entry under no message has no dot", () => {
    expect([...railSpots(index, [id("1-c")])]).toEqual([])
  })

  test("railRings: ends sharing a dot ring it with their readers, each once", () => {
    const rings = railRings(
      index,
      new Map([
        [id("4-r"), ["ada", "bea"]],
        [id("3-a"), ["bea", "cy"]],
      ]),
    )
    expect([...rings]).toEqual([["3-a", ["ada", "bea", "cy"]]])
  })
})

test("stretchWords: a long ask's capsule leads with its ask, then its digest as written", () => {
  expect(stretchWords('Ada: "Fix the rail"', "31 steps", null)).toBe(
    'Ada: "Fix the rail" · 31 steps',
  )
  expect(stretchWords(null, "4 messages from Bea", null)).toBe(
    "4 messages from Bea",
  )
  expect(
    stretchWords("ask", "31 steps", {
      prompt: entryId("ask"),
      at: 0,
      final: true,
      headline: "Fixed the rail",
      points: ["`rail.tsx`"],
    }),
  ).toBe("ask · 31 steps\nFixed the rail\n- `rail.tsx`")
})

test("a live digest's tooltip is its headline alone", () => {
  expect(
    stretchWords("ask", "31 steps", {
      prompt: entryId("ask"),
      at: 0,
      final: false,
      headline: "Fixing the rail",
    }),
  ).toBe("ask · 31 steps\nFixing the rail")
})

test("capsulePick: the message as far through the run as the click is down it", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(entryId)
  const [first] = ids
  if (first === undefined) throw new Error("no ids")
  const run = [first, ...ids.slice(1)] as const
  expect(capsulePick(run, 0)).toBe("a")
  expect(capsulePick(run, 0.55)).toBe("f")
  expect(capsulePick(run, 0.999)).toBe("j")
  // The edges of the border can measure just outside.
  expect([capsulePick(run, -0.01), capsulePick(run, 1)]).toEqual(["a", "j"])
  expect(capsulePick(run, null)).toBe("a")
})

test("stretchFill: the agent alone, people alone, or both", () => {
  const stats = (people: number, agent: number) => ({
    people,
    agent,
    writers: [],
    calls: 0,
    failed: 0,
    files: [],
    private: 0,
    unignored: 0,
    leftovers: 0,
    concurrent: 0,
    first: 0,
    last: 0,
  })
  expect(stretchFill(stats(0, 12))).toBe("agent")
  expect(stretchFill(stats(1, 11))).toBe("mixed")
  expect(stretchFill(stats(11, 1))).toBe("mixed")
  expect(stretchFill(stats(12, 0))).toBe("people")
})

test("railItems: a dot at a thread end holding your card carries your colour", () => {
  const item = (id: string) => ({
    ids: [entryId(id), entryId(`${id}-later`)] as const,
  })
  const marks = railItems([item("c"), item("o")], {
    open: new Set([entryId("o")]),
    mine: { ends: new Set([entryId("c")]), color: "#f0f" },
    matches: null,
  }).map(([, m]) => m)
  expect(marks).toEqual([
    { open: false, mine: "#f0f", matches: null },
    { open: true, mine: null, matches: null },
  ])
})

test("railItems: while searching, an item counts every match among its messages, a capsule's later ones too", () => {
  const item = (id: string) => ({
    ids: [entryId(id), entryId(`${id}-later`)] as const,
  })
  const hit = { from: 0, to: 1 }
  const marks = railItems([item("a"), item("b")], {
    open: new Set(),
    mine: { ends: new Set(), color: "#f0f" },
    matches: { hits: new Map([[entryId("a-later"), [hit] as const]]) },
  }).map(([, m]) => m.matches)
  expect(marks).toEqual([1, 0])
})

test("railView: whole items outlined, one band per branch, and a tick where an edge cuts a capsule", () => {
  const itemOf = new Map<string, ViewItem>()
  const add = (item: ViewItem) => {
    for (const id of item.ids) itemOf.set(id, item)
  }
  add({ slot: 0, span: 1, track: 0, across: 0, ids: ["r"] })
  // Ten messages in a capsule three slots long.
  const run = Array.from({ length: 10 }, (_, i) => `s${i}`)
  const capsule = { slot: 1, span: 3, track: 0, across: 0, ids: run }
  add(capsule)
  add({ slot: 4, span: 1, track: 0, across: 0, ids: ["t"] })
  add({ slot: 5, span: 1, track: 1, across: 1, ids: ["b"] })
  // Five more on the trunk, two slots long, beside the branch.
  const more = Array.from({ length: 5 }, (_, i) => `u${i}`)
  add({ slot: 5, span: 2, track: 0, across: 0, ids: more })
  const edge = (from: number) => ({
    track: 0,
    across: 0,
    slot: 1,
    span: 3,
    from,
    to: from,
  })
  // From halfway into s2 to a quarter into s7: the whole capsule outlined,
  // and a line at each edge, 2.5 and 7.25 tenths down it, never the part
  // between, which drawn would read as the capsule's own fill.
  expect(railView(itemOf, run.slice(2, 8), 0.5, 0.25)).toEqual({
    bands: [{ track: 0, across: 0, top: 0.5, bottom: 3.5 }],
    ticks: [edge(0.25), edge(0.725)],
    extent: { top: 0.5 + 3 * 0.25, bottom: 0.5 + 3 * 0.725 },
  })
  // Part of one message: the two edges are one line.
  expect(railView(itemOf, ["s4"], 0.2, 0.4).ticks).toEqual([
    {
      track: 0,
      across: 0,
      slot: 1,
      span: 3,
      from: (4 + 0.2) / 10,
      to: (4 + 0.4) / 10,
    },
  ])
  // From near one capsule's end, past a dot, into the next capsule: a line
  // in each, and nothing on the dot between.
  expect(
    railView(itemOf, ["s8", "s9", "t", "u0", "u1", "u2"], 0.5, 0.5),
  ).toEqual({
    bands: [{ track: 0, across: 0, top: 0.5, bottom: 6.5 }],
    ticks: [
      edge(8.5 / 10),
      { track: 0, across: 0, slot: 5, span: 2, from: 2.5 / 5, to: 2.5 / 5 },
    ],
    extent: { top: 0.5 + 3 * (8.5 / 10), bottom: 4.5 + 2 * (2.5 / 5) },
  })
  // A dot is whole, wherever the edges are in it, and has no tick.
  expect(railView(itemOf, ["r"], 0.9, 0.1)).toEqual({
    bands: [{ track: 0, across: 0, top: -0.5, bottom: 0.5 }],
    ticks: [],
    extent: { top: -0.5, bottom: 0.5 },
  })
  expect(railView(itemOf, ["nope"], 0, 1).extent).toBeNull()
  // A capsule shown whole has no tick. Onto a branch: a band of its own, in
  // its place, beside the trunk's rows. An id the rail lacks is skipped.
  expect(railView(itemOf, [...run, "t", "nope", "b"], 0, 1)).toEqual({
    bands: [
      { track: 0, across: 0, top: 0.5, bottom: 4.5 },
      { track: 1, across: 1, top: 4.5, bottom: 5.5 },
    ],
    ticks: [],
    extent: { top: 0.5, bottom: 5.5 },
  })
  // The last message of the capsule, then the dot below: one line, where the
  // view's top is; the outline wraps both.
  expect(railView(itemOf, ["s9", "t"], 0.5, 1)).toEqual({
    bands: [{ track: 0, across: 0, top: 0.5, bottom: 4.5 }],
    ticks: [edge(0.95)],
    extent: { top: 0.5 + 3 * 0.95, bottom: 4.5 },
  })
})
