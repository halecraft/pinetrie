// The arrival index (ADR-0013): what a replay's observed document adds to it,
// and how a batch is applied.
import { describe, expect, test } from "vitest"
import {
  ArrivalIndex,
  ArrivalLine,
  type Observed,
  planArrivals,
} from "./arrivals.ts"
import { emptyUsage } from "./deep.ts"

const observed = (o: Partial<Observed>): Observed => ({
  entries: new Map(),
  usage: new Map(),
  values: new Map(),
  lists: new Map(),
  ...o,
})

const entry = (parentId: string | null, type = "message") => ({
  parentId,
  type,
})

describe("planArrivals", () => {
  test("parents come before children, numbered on from the last seq", () => {
    const index = new ArrivalIndex()
    index.apply({ arrivals: [], through: 4 })
    const { batch, cycle } = planArrivals(
      observed({
        entries: new Map([
          ["a", entry("m")],
          ["m", entry("z", "custom")],
          ["z", entry(null)],
        ]),
      }),
      index,
    )
    expect(cycle).toEqual([])
    expect(batch.arrivals).toEqual([
      { kind: "entry", id: "z", seq: 5, message: true },
      { kind: "entry", id: "m", seq: 6, message: false },
      { kind: "entry", id: "a", seq: 7, message: true },
    ])
    expect(batch.through).toBe(7)
  })

  test("a cycle is returned and not sequenced", () => {
    const { batch, cycle } = planArrivals(
      observed({
        entries: new Map([
          ["x", entry("y")],
          ["y", entry("x")],
          ["ok", entry(null)],
        ]),
      }),
      new ArrivalIndex(),
    )
    expect([...cycle].sort()).toEqual(["x", "y"])
    expect(
      batch.arrivals.map(a => (a.kind === "entry" ? a.id : a.kind)),
    ).toEqual(["ok"])
  })

  test("a value gets a new seq when its wid is new, and is gone when the document drops it", () => {
    const index = new ArrivalIndex()
    index.apply({
      arrivals: [
        { kind: "value", pkey: "same", seq: 1, wid: "w1" },
        { kind: "value", pkey: "won", seq: 2, wid: "w2" },
        { kind: "value", pkey: "dropped", seq: 3, wid: "w3" },
      ],
      through: 3,
    })
    const { batch } = planArrivals(
      observed({
        values: new Map([
          ["same", { wid: "w1" }],
          ["won", { wid: "w9" }],
          ["dropped", undefined],
          ["never", undefined],
        ]),
      }),
      index,
    )
    expect(batch.arrivals).toEqual([
      { kind: "gone", field: "values", pkey: "dropped" },
      { kind: "value", pkey: "won", seq: 4, wid: "w9" },
    ])
  })

  test("a record without a wid is present, and once indexed gets no new seq", () => {
    const index = new ArrivalIndex()
    const tokenless = observed({
      values: new Map([["lane", { wid: undefined }]]),
    })
    const first = planArrivals(tokenless, index).batch
    expect(first.arrivals).toEqual([
      { kind: "value", pkey: "lane", seq: 1, wid: undefined },
    ])
    index.apply(first)
    expect(planArrivals(tokenless, index).batch.arrivals).toEqual([])
  })

  test("list elements in document order; a list the document dropped is gone", () => {
    const index = new ArrivalIndex()
    index.apply({
      arrivals: [
        { kind: "element", pkey: "l", eid: "e1", seq: 1 },
        { kind: "element", pkey: "old", eid: "x", seq: 2 },
      ],
      through: 2,
    })
    const { batch } = planArrivals(
      observed({
        lists: new Map([
          ["l", ["e1", "e3", "e2"]],
          ["old", undefined],
        ]),
      }),
      index,
    )
    expect(batch.arrivals).toEqual([
      { kind: "element", pkey: "l", eid: "e3", seq: 3 },
      { kind: "element", pkey: "l", eid: "e2", seq: 4 },
      { kind: "gone", field: "lists", pkey: "old" },
    ])
  })
})

describe("ArrivalLine.walk", () => {
  const line = new ArrivalLine()
  for (const [id, seq] of [
    ["a", 2],
    ["b", 4],
    ["c", 6],
    ["d", 8],
  ] as const)
    line.add(id, seq)
  const ids = (it: Iterable<[string, number]>) => [...it].map(([id]) => id)

  test("bounds are inclusive at both ends, in both orders", () => {
    expect(ids(line.walk("asc", { from: 4, to: 6 }))).toEqual(["b", "c"])
    expect(ids(line.walk("desc", { from: 4, to: 6 }))).toEqual(["c", "b"])
    expect(ids(line.walk("asc", { from: 3, to: 7 }))).toEqual(["b", "c"])
    expect(ids(line.walk("asc", { to: 2 }))).toEqual(["a"])
    expect(ids(line.walk("desc", { from: 8 }))).toEqual(["d"])
  })
  test("an empty range yields nothing; no bounds yields everything", () => {
    expect(ids(line.walk("asc", { from: 5, to: 5 }))).toEqual([])
    expect(ids(line.walk("asc", { from: 9 }))).toEqual([])
    expect(ids(line.walk("desc"))).toEqual(["d", "c", "b", "a"])
  })
  test("an arrival below the last is refused", () => {
    const l = new ArrivalLine()
    l.add("x", 3)
    expect(() => l.add("y", 3)).toThrow(/out of order/)
  })
})

describe("ArrivalIndex.apply", () => {
  test("a batch whose last write is a delete still advances lastSeq to through", () => {
    const index = new ArrivalIndex()
    index.apply({
      arrivals: [
        { kind: "value", pkey: "v", seq: 1, wid: "w" },
        { kind: "gone", field: "values", pkey: "v" },
      ],
      through: 2,
    })
    expect(index.lastSeq).toBe(2)
    expect(index.valueAt("v")).toBeUndefined()
  })
  test("message entries count, and usage totals add", () => {
    const index = new ArrivalIndex()
    const usage = { ...emptyUsage(), input: 3 }
    index.apply({
      arrivals: [
        { kind: "entry", id: "e1", seq: 1, message: true },
        { kind: "entry", id: "e2", seq: 2, message: false },
        { kind: "usage", id: "u1", seq: 3, usage },
        { kind: "usage", id: "u2", seq: 4, usage },
      ],
      through: 4,
    })
    expect(index.stats().messageCount).toBe(1)
    expect(index.stats().usage.input).toBe(6)
  })
})
