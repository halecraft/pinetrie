import {
  type AgentMessageLike,
  type EntryId,
  type EntryLike,
  entryId,
  indexAsks,
  indexTree,
  projectRail,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { entriesById, entry, fromParents, personMessage } from "./fixtures.ts"
import { compactRail, type RailItem, stretchSpan } from "./rail.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (parents: Record<string, string | null>) =>
  fromParents(parents, id => personMessage(id, { author: "A" }))

// The plan's example: a trunk T1 -> T2 -> T3, a branch A off T1, a branch B off
// T2. The trunk's continuation is older than each branch.
const forks = tree({
  "1-t1": null,
  "2-t2": "1-t1",
  "3-t3": "2-t2",
  "4-a1": "1-t1",
  "5-a2": "4-a1",
  "6-b1": "2-t2",
  "7-b2": "6-b1",
})

describe("compactRail", () => {
  const pad = (n: number) => String(n).padStart(3, "0")
  /**
   * A person's question, `steps` agent messages that each call `read` and get
   * a result, and a reply. Ids sort in the order written. Step k is
   * `${pad(2k)}-s`, its result `${pad(2k + 1)}-r`.
   */
  const loop = (steps: number, failAt?: number) => {
    const out: EntryLike[] = [
      entry("000-q", null, { role: "user", content: "" }),
    ]
    let parent = "000-q"
    for (let k = 1; k <= steps; k += 1) {
      const step = `${pad(2 * k)}-s`
      const result = `${pad(2 * k + 1)}-r`
      out.push(
        entry(step, parent, {
          role: "assistant",
          content: [
            { type: "toolCall", id: `c${k}`, name: "read", arguments: {} },
          ],
        }),
        entry(result, step, {
          role: "toolResult",
          toolCallId: `c${k}`,
          content: "",
          isError: k === failAt,
        }),
      )
      parent = result
    }
    out.push(entry("999-a", parent, { role: "assistant", content: "done" }))
    return entriesById(out)
  }
  const steps = (n: number) =>
    Array.from({ length: n }, (_, k) => `${pad(2 * (k + 1))}-s`)
  const compact = (
    entries: Record<EntryId, EntryLike>,
    root: string,
    keep: readonly string[] = [],
  ) => {
    const i = indexTree(entries)
    return compactRail(
      i,
      projectRail(i, entryId(root)),
      new Set(keep.map(entryId)),
      {
        asks: indexAsks(i),
        revisions: new Map(),
      },
    )
  }
  const shape = (items: readonly RailItem[]) =>
    items.map(it => (it.kind === "dot" ? it.ids[0] : [...it.ids]))

  test("an agent loop between a question and its reply is one stretch", () => {
    const items = compact(loop(12), "000-q")
    expect(shape(items)).toEqual(["000-q", steps(12), "999-a"])
    expect(items[1]).toMatchObject({
      kind: "stretch",
      span: 3,
      stats: { people: 0, writers: [], calls: 12, failed: 0 },
    })
  })
  test("one or two uneventful messages stay dots", () => {
    expect(shape(compact(loop(1), "000-q"))).toEqual([
      "000-q",
      "002-s",
      "999-a",
    ])
    expect(shape(compact(loop(2), "000-q"))).toEqual([
      "000-q",
      "002-s",
      "004-s",
      "999-a",
    ])
  })
  test("roots, forks, branches and thread ends are never in a stretch", () => {
    const branched = tree({
      "01": null,
      "02": "01",
      "03": "02",
      "04": "03",
      "05": "04",
      "06": "05",
      "07": "02",
      "08": "07",
      "09": "08",
      "10": "09",
      "11": "10",
    })
    expect(shape(compact(branched, "01"))).toEqual([
      "01",
      "02",
      ["03", "04", "05"],
      "06",
      "07",
      ["08", "09", "10"],
      "11",
    ])
  })
  test("a kept message splits a stretch around it", () => {
    const [a, b] = [steps(12).slice(0, 5), steps(12).slice(6)]
    expect(shape(compact(loop(12), "000-q", ["012-s"]))).toEqual([
      "000-q",
      a,
      "012-s",
      b,
      "999-a",
    ])
  })
  test("a failed call counts, its result below the stretch's last message included", () => {
    const stretch = (failAt: number) =>
      compact(loop(12, failAt), "000-q").find(it => it.kind === "stretch")
    expect(stretch(3)).toMatchObject({ stats: { calls: 12, failed: 1 } })
    expect(stretch(12)).toMatchObject({ stats: { calls: 12, failed: 1 } })
  })
  test("a stretch's span is one row, and one more per digit of its size", () => {
    expect([3, 9, 10, 99, 100].map(stretchSpan)).toEqual([2, 2, 3, 3, 4])
    expect(compact(loop(100), "000-q")[1]).toMatchObject({ span: 4 })
  })
  test("the shortest capsule follows from the client's span: two messages in one row", () => {
    const i = indexTree(loop(2))
    const oneRow = compactRail(
      i,
      projectRail(i, entryId("000-q")),
      new Set(),
      { asks: indexAsks(i), revisions: new Map() },
      () => 1,
    )
    expect(shape(oneRow)).toEqual(["000-q", steps(2), "999-a"])
    expect(oneRow[1]).toMatchObject({ kind: "stretch", span: 1 })
  })
  test("every row is in exactly one item, in order", () => {
    const i = indexTree({ ...loop(12), ...tree({ "005-x": "004-s" }) })
    const rows = projectRail(i, entryId("000-q"))
    const items = compactRail(i, rows, new Set(), {
      asks: indexAsks(i),
      revisions: new Map(),
    })
    expect(items.flatMap(it => it.ids)).toEqual(rows.map(r => r.id))
  })
  test("a stretch counts the messages people wrote, and who, in order", () => {
    const ada = writerId("w-ada")
    const bea = writerId("w-bea")
    const said = (writer: typeof ada) =>
      personMessage("", { author: "", writer })
    const agent: AgentMessageLike = { role: "assistant", content: "ok" }
    const items = compact(
      entriesById([
        entry("01", null, said(ada)),
        entry("02", "01", said(bea)),
        entry("03", "02", agent),
        entry("04", "03", said(ada)),
        entry("05", "04", agent),
        entry("06", "05", said(bea)),
      ]),
      "01",
    )
    expect(items[1]).toMatchObject({
      ids: ["02", "03", "04", "05"],
      stats: { people: 2, writers: [bea, ada], calls: 0 },
    })
  })
})

describe("placeRail", () => {
  /** The rail's items, every message kept apart unless `compacted`. */
  const items = (
    entries: Record<EntryId, EntryLike>,
    root: string,
    compacted = false,
  ) => {
    const i = indexTree(entries)
    const rows = projectRail(i, entryId(root))
    return compactRail(i, rows, new Set(compacted ? [] : rows.map(r => r.id)), {
      asks: indexAsks(i),
      revisions: new Map(),
    })
  }
  /** Each item by its first message: `[slot, across]`. */
  const at = (placed: readonly RailItem[]) =>
    Object.fromEntries(placed.map(it => [it.ids[0], [it.slot, it.across]]))
  /** Rows a branch takes: from its fork's last row to its own last row. */
  const ranges = (placed: readonly RailItem[]) => {
    const itemOf = new Map(placed.flatMap(it => it.ids.map(id => [id, it])))
    const last = (it: RailItem) => it.slot + it.span - 1
    const out = new Map<number, { from: number; to: number; across: number }>()
    for (const it of placed) {
      const fork = it.parentId === null ? undefined : itemOf.get(it.parentId)
      const was = out.get(it.track)
      out.set(it.track, {
        from: was?.from ?? (fork === undefined ? it.slot : last(fork)),
        to: Math.max(was?.to ?? 0, last(it)),
        across: it.across,
      })
    }
    return [...out.values()]
  }

  test("a branch starts on the row under its fork, beside the older subtree", () => {
    expect(at(items(forks, "1-t1"))).toEqual({
      "1-t1": [0, 0],
      "2-t2": [1, 0],
      "3-t3": [2, 0],
      "6-b1": [2, 2],
      "7-b2": [3, 2],
      "4-a1": [1, 1],
      "5-a2": [2, 1],
    })
  })
  test("an item under a capsule starts on the row after the capsule's last", () => {
    const ids = (["001", "002", "003", "004", "005", "006"] as const).map(
      n => `${n}-m`,
    )
    const placed = items(
      tree(Object.fromEntries(ids.map((id, k) => [id, ids[k - 1] ?? null]))),
      "001-m",
      true,
    )
    expect(placed.map(it => [it.slot, it.span])).toEqual([
      [0, 1],
      [1, 2],
      [3, 1],
    ])
  })
  test("a branch that has ended frees its place for a later one", () => {
    const trunk = { "01": null, "02": "01", "03": "02", "04": "03" }
    const placed = items(
      tree({ ...trunk, "05": "04", "06": "05", "10": "01", "11": "04" }),
      "01",
    )
    expect(at(placed)["10"]).toEqual([1, 1])
    expect(at(placed)["11"]).toEqual([4, 1])
  })
  test("a branch never takes a place whose branch ends on its fork's row", () => {
    // A ends on row 2, and B forks from row 2: B's bend would meet A's dot.
    const placed = items(
      tree({
        "01": null,
        "02": "01",
        "03": "02",
        "04": "03",
        "10": "01",
        "11": "10",
        "12": "03",
      }),
      "01",
    )
    expect(at(placed)["11"]).toEqual([2, 1])
    expect(at(placed)["12"]).toEqual([3, 2])
  })
  test("a root that is no message starts its children side by side on row 0", () => {
    const placed = items(
      {
        ...tree({ "1-a": "0-s", "2-b": "0-s", "3-c": "1-a" }),
        ...entriesById([entry("0-s", null, undefined, { type: "compaction" })]),
      },
      "0-s",
    )
    expect(at(placed)).toEqual({
      "1-a": [0, 0],
      "3-c": [1, 0],
      "2-b": [0, 1],
    })
  })
  test("in a bushy tree no two branches share a place on a row, and the rail is as narrow as its busiest row", () => {
    // A fixed pseudo-random tree: mostly chains, with forks anywhere.
    let seed = 7
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const parents: Record<string, string | null> = { "000": null }
    for (let k = 1; k < 120; k += 1) {
      const back = next() < 0.75 ? 1 : 1 + Math.floor(next() * k)
      parents[String(k).padStart(3, "0")] = String(k - back).padStart(3, "0")
    }
    const placed = items(tree(parents), "000", true)
    const branches = ranges(placed)
    expect(branches.length).toBeGreaterThan(10)
    for (const [n, a] of branches.entries())
      for (const b of branches.slice(n + 1))
        if (a.across === b.across)
          expect(a.to < b.from || b.to < a.from).toBe(true)
    const rows = Math.max(...branches.map(b => b.to)) + 1
    const busiest = Math.max(
      ...Array.from(
        { length: rows },
        (_, row) => branches.filter(b => b.from <= row && row <= b.to).length,
      ),
    )
    expect(Math.max(...placed.map(it => it.across)) + 1).toBe(busiest)
  })
})
