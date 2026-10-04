import { describe, expect, test } from "vitest"
import { entriesOf, entry, fromParents } from "./fixtures.ts"
import {
  agentActivity,
  ancestry,
  applyEdits,
  atEntry,
  branchColors,
  type ChatMode,
  cardId,
  compactRail,
  type EntryId,
  type EntryLike,
  entryId,
  followTip,
  indexAsks,
  indexTree,
  type LaneName,
  laneNameForThread,
  messageImages,
  PENDING_TRACK,
  type PinnedView,
  type Position,
  pinnedInView,
  projectColumns,
  projectRail,
  projectSpine,
  projectTranscript,
  promptOf,
  type RailItem,
  ROOT,
  rootOf,
  startsRun,
  stretchSpan,
  tailEdit,
  threadOf,
  toolLabel,
  wholeToolLabel,
  writerId,
  writersOf,
} from "./index.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (parents: Record<string, string | null>) =>
  fromParents(parents, id => ({ role: "chat", content: id, author: "A" }))

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
const ids = (nodes: readonly { id: string }[]) => nodes.map(n => n.id)

describe("indexTree and ancestry", () => {
  test("children are sorted by id, whatever the insertion order", () => {
    const shuffled = entriesOf(Object.values(forks).toReversed())
    expect(indexTree(shuffled).childrenOf.get(entryId("1-t1"))).toEqual([
      "2-t2",
      "4-a1",
    ])
  })
  test("roots and orphans are reported", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "8-r": null }),
    })
    expect([i.roots, i.orphans]).toEqual([["1-t1", "8-r"], ["9-x"]])
  })
  test("rootOf walks up to the root; an orphan is its own root", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "a-y": "9-x" }),
    })
    expect(rootOf(i, entryId("7-b2"))).toBe("1-t1")
    expect(rootOf(i, entryId("1-t1"))).toBe("1-t1")
    expect(rootOf(i, entryId("a-y"))).toBe("9-x")
    expect(rootOf(i, entryId("nope"))).toBeNull()
  })
  test("a cycle stops ancestry and is reported", () => {
    const cyclic = tree({ x: "y", y: "x" })
    expect(ancestry(indexTree(cyclic), entryId("x"))).toEqual({
      path: ["x", "y"],
      cycleAt: "x",
    })
  })
})

describe("followTip: the view follows the thread you are reading", () => {
  const entries = tree({
    "1-a1": null,
    "2-a2": "1-a1",
    "3-b2": "1-a1",
    "4-a3": "2-a2",
  })
  test("follows a newer reply below what you read, whichever lane wrote it", () => {
    expect(followTip(indexTree(entries), entryId("2-a2"))).toBe("4-a3")
  })
  test("never jumps to a branch that is not below you", () => {
    const newer = { ...entries, ...tree({ "5-b3": "3-b2" }) }
    expect(followTip(indexTree(newer), entryId("2-a2"))).toBe("4-a3")
  })
  test("a cycle stops the walk rather than spinning", () => {
    expect(
      followTip(indexTree(tree({ w: "x", x: "y", y: "x" })), entryId("z")),
    ).toBe("z")
  })
  test("walking down from an entry on a cycle ends", () => {
    // Going down, a cycle is reachable only from inside it: each entry has one
    // parent, so no chain leaves a cycle to reach it from outside.
    // Every entry on a cycle has a child, so there is no leaf below: `at` stands.
    expect(followTip(indexTree(tree({ x: "y", y: "x" })), entryId("x"))).toBe(
      "x",
    )
  })
})

describe("projectColumns", () => {
  const i = indexTree(forks)
  test("a first column is its whole path", () => {
    const [c] = projectColumns(i, [{ anchor: entryId("3-t3") }])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      null,
      ["1-t1", "2-t2", "3-t3"],
    ])
  })
  test("a branch starts after the deepest message it shares with ANY column to its left", () => {
    const [, a, b] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("4-a1") },
      { anchor: entryId("6-b1") },
    ])
    expect([a?.forkFrom, ids(a?.nodes ?? [])]).toEqual([
      "1-t1",
      ["4-a1", "5-a2"],
    ])
    // B shares only T1 with its neighbour A, but T2 with the trunk.
    expect([b?.forkFrom, ids(b?.nodes ?? [])]).toEqual([
      "2-t2",
      ["6-b1", "7-b2"],
    ])
  })
  test("making a branch main recomputes every fork point", () => {
    const [a, trunk] = projectColumns(i, [
      { anchor: entryId("4-a1") },
      { anchor: entryId("3-t3") },
    ])
    expect(ids(a?.nodes ?? [])).toEqual(["1-t1", "4-a1", "5-a2"])
    expect([trunk?.forkFrom, ids(trunk?.nodes ?? [])]).toEqual([
      "1-t1",
      ["2-t2", "3-t3"],
    ])
  })
  test("a column on another root shares nothing: no fork, its full path", () => {
    const other = indexTree({
      ...forks,
      ...tree({ "8-r1": null, "9-r2": "8-r1" }),
    })
    const [, c] = projectColumns(other, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("8-r1") },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([null, ["8-r1", "9-r2"]])
  })
  test("an anchored column (fresh, or bound to a lane) ends at its anchor and follows nothing", () => {
    const [, c] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("2-t2"), anchored: true },
    ])
    expect([c?.tipId, c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      "2-t2",
      "2-t2",
      [],
    ])
    // A fresh column at the root: nothing at all, and no fork.
    const [, root] = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: null, anchored: true },
    ])
    expect([root?.tipId, root?.forkFrom, root?.nodes]).toEqual([null, null, []])
  })
})

describe("writersOf", () => {
  test("each writer once, in order of their first message", () => {
    const ada = writerId("w-ada")
    const bea = writerId("w-bea")
    const by = (writer: typeof ada) => ({ role: "chat", author: "", writer })
    const i = indexTree(
      entriesOf([
        entry("1-a", null, by(bea)),
        entry("2-b", "1-a", by(ada)),
        entry("3-c", "2-b", by(bea)),
        entry("4-d", "3-c"),
      ]),
    )
    expect(
      writersOf(i, [
        entryId("4-d"),
        entryId("3-c"),
        entryId("2-b"),
        entryId("1-a"),
      ]),
    ).toEqual([bea, ada])
    expect(writersOf(i, [entryId("3-c"), entryId("2-b")])).toEqual([ada, bea])
  })
})

describe("projectRail", () => {
  const rows = projectRail(indexTree(forks), entryId("1-t1"))
  const trackOf = (id: string) => rows.find(r => r.id === id)?.track
  test("the oldest child continues its parent's track; a younger one takes a new track", () => {
    expect([trackOf("1-t1"), trackOf("2-t2"), trackOf("3-t3")]).toEqual([
      0, 0, 0,
    ])
    expect(trackOf("4-a1")).toBe(1)
    expect(trackOf("6-b1")).toBe(2)
  })
  test("a branch's track is its first message's rank by id, so a new branch moves no other", () => {
    // A branch off A's first message: the fourth branch made, so track 3,
    // though the trunk's track 0 has ended by then in depth-first order. A
    // newer branch off T2 is drawn before A's, and still takes the next number.
    const sub = projectRail(
      indexTree({ ...forks, ...tree({ "8-s1": "4-a1" }) }),
      entryId("1-t1"),
    )
    expect(sub.find(r => r.id === "8-s1")?.track).toBe(3)
    const newer = projectRail(
      indexTree({ ...forks, ...tree({ "8-s1": "4-a1", "9-n1": "2-t2" }) }),
      entryId("1-t1"),
    )
    for (const r of sub)
      expect(newer.find(n => n.id === r.id)?.track).toBe(r.track)
    expect(newer.find(r => r.id === "9-n1")?.track).toBe(4)
  })
  test("rows are depth-first, children in id order, each with its parent's track", () => {
    expect(ids(rows)).toEqual([
      "1-t1",
      "2-t2",
      "3-t3",
      "6-b1",
      "7-b2",
      "4-a1",
      "5-a2",
    ])
    expect(rows.find(r => r.id === "6-b1")).toMatchObject({
      parentId: "2-t2",
      head: true,
    })
    expect(rows.find(r => r.id === "3-t3")).toMatchObject({ head: false })
  })
  test("the same entries in another insertion order give the same rows", () => {
    const shuffled = entriesOf(Object.values(forks).toReversed())
    expect(projectRail(indexTree(shuffled), entryId("1-t1"))).toEqual(rows)
  })
  test("draws only its root's tree, from track 0", () => {
    const i = indexTree({ ...forks, ...tree({ "8-r1": null, "9-r2": "8-r1" }) })
    expect(ids(projectRail(i, entryId("8-r1")))).toEqual(["8-r1", "9-r2"])
    expect(projectRail(i, entryId("8-r1"))[0]).toMatchObject({
      track: 0,
      parentId: null,
    })
    expect(ids(projectRail(i, entryId("1-t1")))).toEqual(ids(rows))
  })
  test("a non-message entry has no row; its child attaches to the message above", () => {
    const withCompaction = {
      ...forks,
      "8-c": { id: "8-c", parentId: "3-t3", type: "compaction" },
      ...tree({ "9-after": "8-c" }),
    }
    const r = projectRail(indexTree(withCompaction), entryId("1-t1"))
    expect(r.some(x => x.id === "8-c")).toBe(false)
    expect(r.find(x => x.id === "9-after")).toMatchObject({
      parentId: "3-t3",
      track: 0,
    })
  })
})

describe("compactRail", () => {
  const pad = (n: number) => String(n).padStart(3, "0")
  /**
   * A person's question, `steps` agent messages that each call `read` and get
   * a result, and a reply. Ids sort in the order written. Step k is
   * `${pad(2k)}-s`, its result `${pad(2k + 1)}-r`.
   */
  const loop = (steps: number, failAt?: number) => {
    const out: EntryLike[] = [entry("000-q", null, { role: "user" })]
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
    return entriesOf(out)
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
    const chat = (writer: typeof ada) => ({ role: "chat", author: "", writer })
    const agent = { role: "assistant", content: "ok" }
    const items = compact(
      entriesOf([
        entry("01", null, chat(ada)),
        entry("02", "01", chat(bea)),
        entry("03", "02", agent),
        entry("04", "03", chat(ada)),
        entry("05", "04", agent),
        entry("06", "05", chat(bea)),
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
        ...entriesOf([entry("0-s", null, undefined, { type: "compaction" })]),
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

describe("colour and the agent", () => {
  const i = indexTree(forks)
  const rail = projectRail(i, entryId("1-t1"))
  test("a column's colour is its last message's track; its fork dot matches", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("4-a1") },
      { anchor: entryId("6-b1") },
    ])
    const c = branchColors(rail, cols)
    expect(c.track).toEqual([0, 1, 2])
    expect([...c.forks]).toEqual([
      ["1-t1", [1]],
      ["2-t2", [2]],
    ])
  })
  test("a fresh branch is pending until it has a message", () => {
    const cols = projectColumns(i, [
      { anchor: entryId("3-t3") },
      { anchor: entryId("2-t2"), anchored: true },
    ])
    expect(branchColors(rail, cols).track).toEqual([0, PENDING_TRACK])
  })
  test("the agent is idle with no running lane; a lane runs once it has a tip", () => {
    expect(agentActivity([])).toEqual([])
    const runs = agentActivity([
      { lane: laneNameForThread("a"), tip: entryId("5-a2") },
      { lane: laneNameForThread("b"), tip: entryId("7-b2") },
      { lane: laneNameForThread("new"), tip: null },
    ])
    expect(runs.map(r => [r.lane, r.tip])).toEqual([
      ["t-a", "5-a2"],
      ["t-b", "7-b2"],
    ])
  })
})

describe("threads: where a message lands, and whether it raced", () => {
  // 1-q is Wu's question; below it the agent's reply, a remark, and questions.
  const say = (
    id: string,
    parentId: string | null,
    extra: { readonly writer: string; readonly compelled: boolean },
  ) =>
    entry(id, parentId, {
      role: "chat",
      content: id,
      writer: writerId(extra.writer),
      compelled: extra.compelled,
    })
  const entries = entriesOf([
    say("1-q", null, { writer: "wu", compelled: true }),
    entry("2-r", "1-q", { role: "assistant", content: "r" }),
    say("3-plain", "2-r", { writer: "bo", compelled: false }),
    say("4-mine", "3-plain", { writer: "wu", compelled: true }),
  ])
  const at = (id: string) => atEntry(entryId(id))

  const me = writerId("wu")
  const lane = (tip: string | null, name = "x") => ({
    name: laneNameForThread(name),
    tip: tip === null ? null : entryId(tip),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  })
  const send = (
    at: Position,
    mode: ChatMode = "reply",
    named: LaneName | null = null,
  ) => ({ at, mode, lane: named, me })

  test("threadOf: a reply lands at the newest leaf; a branch starts at `at`, with no lane", () => {
    const i = indexTree(entries)
    const lanes = [lane("4-mine")]
    expect(threadOf(i, lanes, send(at("1-q")))).toMatchObject({
      end: at("4-mine"),
      lane: { kind: "lane" },
    })
    expect(threadOf(i, lanes, send(at("4-mine"), "branch"))).toEqual({
      kind: "thread",
      end: at("4-mine"),
      lane: { kind: "none" },
      race: null,
    })
    // Only a branch starts at the root, and an unknown entry is no thread.
    expect(threadOf(i, lanes, send(ROOT)).kind).toBe("unknown")
    expect(threadOf(i, lanes, send(ROOT, "branch")).kind).toBe("thread")
    expect(threadOf(i, lanes, send(at("9-gone"))).kind).toBe("unknown")
  })

  test("threadOf: a named lane is its thread, past a newer conversation forked at its tip", () => {
    // 5-conv steps down at the lane's old tip; the lane then moved on to 6-next.
    const i = indexTree({
      ...entries,
      ...entriesOf([
        say("6-next", "4-mine", { writer: "wu", compelled: false }),
        say("7-conv", "4-mine", { writer: "bo", compelled: false }),
      ]),
    })
    const lanes = [lane("6-next")]
    expect(threadOf(i, lanes, send(at("4-mine"))).kind).toBe("thread")
    // Unnamed, the newest leaf wins: the conversation.
    expect(threadOf(i, lanes, send(at("4-mine")))).toMatchObject({
      end: at("7-conv"),
    })
    const named = threadOf(
      i,
      lanes,
      send(at("4-mine"), "reply", lanes[0]?.name),
    )
    expect(named).toMatchObject({ end: at("6-next"), lane: { kind: "lane" } })
    // `at` off the lane's path, or a lane that does not exist: refused.
    expect(
      threadOf(i, lanes, send(at("7-conv"), "reply", lanes[0]?.name)).kind,
    ).toBe("unknown")
    expect(
      threadOf(i, lanes, send(at("4-mine"), "reply", laneNameForThread("no")))
        .kind,
    ).toBe("unknown")
  })

  test("threadOf: one lane ending at the end is its lane; two are ambiguous", () => {
    const i = indexTree(entries)
    const lane4 = (lanes: ReturnType<typeof lane>[]) =>
      threadOf(i, lanes, send(at("4-mine")))
    expect(lane4([lane("4-mine")])).toMatchObject({ lane: { kind: "lane" } })
    expect(lane4([lane("3-plain")])).toMatchObject({ lane: { kind: "none" } })
    expect(lane4([lane("4-mine", "x"), lane("4-mine", "y")]).kind).toBe(
      "ambiguous",
    )
  })

  test("threadOf: a named lane is that lane, even while another shares its tip", () => {
    const i = indexTree(entries)
    const y = laneNameForThread("y")
    expect(
      threadOf(
        i,
        [lane("4-mine", "x"), lane("4-mine", "y")],
        send(at("4-mine"), "reply", y),
      ),
    ).toMatchObject({ lane: { kind: "lane", name: y } })
  })

  test("threadOf race: an agent reply, a plain remark and my own question are not a race", () => {
    expect(threadOf(indexTree(entries), [], send(at("1-q")))).toMatchObject({
      race: null,
    })
  })

  test("threadOf race: another writer's compelled message on the thread is; in a sibling fork, not", () => {
    const raced = indexTree({
      ...entries,
      ...entriesOf([
        say("5-theirs", "4-mine", { writer: "bo", compelled: true }),
      ]),
    })
    expect(threadOf(raced, [], send(at("1-q")))).toMatchObject({
      race: { by: "w-bo" },
    })
    // Nothing below the newest message: no race from there.
    expect(threadOf(raced, [], send(at("5-theirs")))).toMatchObject({
      race: null,
    })
    // Bob asks in a fork at 2-r; my thread continues through 6-mine, newer.
    const forked = indexTree({
      ...entries,
      ...entriesOf([
        say("5-fork", "2-r", { writer: "bo", compelled: true }),
        say("6-mine", "4-mine", { writer: "wu", compelled: false }),
      ]),
    })
    expect(threadOf(forked, [], send(at("1-q")))).toMatchObject({
      end: at("6-mine"),
      race: null,
    })
  })
})

describe("tool calls: paired with their results on the path", () => {
  const call = (id: string, name: string, args: unknown) => ({
    type: "toolCall",
    id,
    name,
    arguments: args,
  })
  const entries = entriesOf([
    entry("1-q", null, { role: "user", content: "what is in notes?" }),
    entry("2-a", "1-q", {
      role: "assistant",
      content: [call("c1", "read", { path: "notes.txt" })],
    }),
    entry("3-r", "2-a", {
      role: "toolResult",
      toolCallId: "c1",
      content: [{ type: "text", text: "MANGO" }],
      isError: false,
    }),
    entry("4-a", "3-r", { role: "assistant", content: "It says MANGO." }),
    // A sibling branch answering the same call id: not on the main path.
    entry("5-r", "2-a", {
      role: "toolResult",
      toolCallId: "c1",
      content: [{ type: "text", text: "elsewhere" }],
      isError: true,
    }),
  ])
  const i = indexTree(entries)

  test("a call and its result on one path pair; a message with only calls keeps them", () => {
    const { spine } = projectSpine(i, entryId("4-a"))
    expect(spine.map(n => n.id)).toEqual(["1-q", "2-a", "4-a"])
    expect(spine[1]?.toolCalls).toEqual([
      {
        id: "c1",
        name: "read",
        label: "read notes.txt",
        subject: "notes.txt",
        result: { text: "MANGO", isError: false, images: [] },
      },
    ])
  })
  test("a result's stored images are on its call", () => {
    const image = {
      type: "image",
      mimeType: "image/png",
      sha256: "a".repeat(64),
      width: 40,
      height: 30,
    }
    const read = indexTree({
      ...entries,
      ...entriesOf([
        entry("6-a", "4-a", {
          role: "assistant",
          content: [call("c6", "read", { path: "shot.png" })],
        }),
        entry("7-r", "6-a", {
          role: "toolResult",
          toolCallId: "c6",
          content: [
            { type: "text", text: "Read image file [image/png]" },
            image,
          ],
          isError: false,
        }),
        entry("8-a", "7-r", { role: "assistant", content: "A red square." }),
      ]),
    })
    expect(projectSpine(read, entryId("8-a")).spine.at(-2)?.toolCalls).toEqual([
      {
        id: "c6",
        name: "read",
        label: "read shot.png",
        subject: "shot.png",
        result: {
          text: "Read image file [image/png]",
          isError: false,
          images: [
            {
              sha256: image.sha256,
              mimeType: "image/png",
              width: 40,
              height: 30,
            },
          ],
        },
      },
    ])
  })
  test("a call whose label is cut carries it uncut", () => {
    const command = "pnpm test\necho done"
    const long = indexTree({
      ...entries,
      ...entriesOf([
        entry("9-a", "4-a", {
          role: "assistant",
          content: [call("c9", "bash", { command })],
        }),
      ]),
    })
    expect(projectSpine(long, entryId("9-a")).spine.at(-1)?.toolCalls).toEqual([
      {
        id: "c9",
        name: "bash",
        label: "bash pnpm test",
        wholeLabel: `bash ${command}`,
        subject: command,
      },
    ])
  })
  test("a result off the path does not pair", () => {
    // Path to 5-r: its result pairs; path to 2-a alone: no result yet.
    expect(
      projectSpine(i, entryId("2-a")).spine[1]?.toolCalls?.[0]?.result,
    ).toBeUndefined()
    expect(
      projectSpine(i, entryId("5-r")).spine[1]?.toolCalls?.[0]?.result,
    ).toEqual({
      text: "elsewhere",
      isError: true,
      images: [],
    })
  })
  test("a branch's message count ignores tool results", () => {
    const { spine } = projectSpine(i, entryId("1-q"))
    expect(spine[0]?.branches).toEqual([{ rootId: "2-a", messageCount: 2 }])
  })
})

describe("messageImages: only stored references", () => {
  const ref = {
    type: "image",
    mimeType: "image/png",
    sha256: "b".repeat(64),
    width: 40,
    height: 30,
  }
  const images = (...parts: Record<string, unknown>[]) =>
    messageImages({ role: "toolResult", content: parts })

  test("a reference is an image", () => {
    expect(images({ type: "text", text: "x" }, ref)).toEqual([
      { sha256: ref.sha256, mimeType: "image/png", width: 40, height: 30 },
    ])
  })
  test.each<[string, Record<string, unknown>]>([
    ["inline bytes", { type: "image", data: "iVBOR", mimeType: "image/png" }],
    ["bytes beside a reference", { ...ref, data: "iVBOR" }],
    ["a malformed hash", { ...ref, sha256: "B".repeat(64) }],
    ["a type no provider takes", { ...ref, mimeType: "image/svg+xml" }],
    ["no width", { ...ref, width: 0 }],
    ["a fractional height", { ...ref, height: 1.5 }],
  ])("%s is not one", (_, part) => {
    expect(images(part)).toEqual([])
  })
  test("text content has none", () => {
    expect(messageImages({ role: "user", content: "hi" })).toEqual([])
  })
})

describe("toolLabel and tailEdit", () => {
  test("toolLabel names what the call touches", () => {
    expect(toolLabel("read", { path: "a.ts" })).toBe("read a.ts")
    expect(toolLabel("bash", { command: "pnpm test\necho done" })).toBe(
      "bash pnpm test",
    )
    expect(toolLabel("mystery", { x: 1 })).toBe("mystery")
    expect(toolLabel("constructor", { path: "a" })).toBe("constructor")
    expect(toolLabel("grep", { pattern: "TODO", path: "src" })).toBe(
      "grep TODO src",
    )
    expect(toolLabel("find", { pattern: "*.ts" })).toBe("find *.ts")
  })

  test("wholeToolLabel is the label uncut, and nothing when it is not cut", () => {
    expect(wholeToolLabel("bash", { command: "pnpm test" })).toBeUndefined()
    expect(wholeToolLabel("bash", { command: "pnpm test\necho done" })).toBe(
      "bash pnpm test\necho done",
    )
    const long = `echo ${"x".repeat(200)}`
    expect(toolLabel("bash", { command: long }).endsWith("…")).toBe(true)
    expect(wholeToolLabel("bash", { command: long })).toBe(`bash ${long}`)
    expect(wholeToolLabel("read", { path: "a.ts" })).toBeUndefined()
    expect(wholeToolLabel("mystery", { x: 1 })).toBeUndefined()
  })

  // A tail-kept view: lines 1..n, keeping the last `keep` lines.
  const view = (n: number, keep: number) =>
    Array.from({ length: n }, (_, k) => `line ${k + 1} ${"x".repeat(k % 7)}\n`)
      .slice(-keep)
      .join("")

  test("tailEdit reproduces every snapshot, however the view moved", () => {
    const cases: [string, string][] = [
      ["", "a"],
      ["abc", "abcdef"],
      [view(10, 10), view(14, 10)],
      [view(30, 8), view(31, 8)],
      ["unrelated", "different text"],
      ["abc", ""],
      ["same", "same"],
    ]
    for (const [prev, next] of cases)
      expect(applyEdits(prev, tailEdit(prev, next))).toBe(next)
  })
  test("tailEdit appends as one insert, and a moved tail as a front cut plus an append", () => {
    expect(tailEdit("abc", "abcdef")).toEqual([
      { at: 3, remove: 0, insert: "def" },
    ])
    const prev = view(30, 8)
    const next = view(32, 8)
    const edits = tailEdit(prev, next)
    expect(edits.length).toBe(2)
    expect(edits[0]).toMatchObject({ at: 0, insert: "" })
    expect(edits[1]?.remove).toBe(0)
    // Each edit carries only what changed, never the whole view again.
    expect(edits.reduce((n, x) => n + x.insert.length, 0)).toBeLessThan(
      next.length / 2,
    )
  })
})

describe("pinned cards in the tree (ADR-0048)", () => {
  const card = (id: string, text: string) => ({
    id: cardId(id),
    text,
    by: writerId("ada@example.com"),
  })
  const LANE = laneNameForThread("x")
  const OTHER = laneNameForThread("p")
  const cards = (
    id: string,
    parent: string | null,
    view: PinnedView,
  ): EntryLike =>
    entry(id, parent, { role: "pinned", content: "", pinned: view })
  const first: PinnedView = {
    lane: OTHER,
    cards: [card("c-1", "a")],
    retired: [],
  }
  const second: PinnedView = {
    lane: LANE,
    cards: [card("c-2", "b")],
    retired: [{ id: cardId("c-1"), line: "a" }],
  }
  // 1-q -> 2-cards(first) -> 3-p1 -> 4-r1 -> 5-cards(second) -> 6-p2 -> 7-r2
  const list = [
    entry("1-q", null, { role: "chat", content: "q", author: "A" }),
    cards("2-cards", "1-q", first),
    entry("3-p1", "2-cards", { role: "chat", content: "p1", author: "A" }),
    entry("4-r1", "3-p1", { role: "assistant", content: "r1" }),
    cards("5-cards", "4-r1", second),
    entry("6-p2", "5-cards", { role: "chat", content: "p2", author: "A" }),
    entry("7-r2", "6-p2", { role: "assistant", content: "r2" }),
  ]
  const index = indexTree(entriesOf(list))

  test("a cards entry is no message: not in the transcript, nor the spine, nor a prompt", () => {
    const tip = entryId("7-r2")
    expect(projectTranscript(index, tip).map(m => m.id)).toEqual([
      "1-q",
      "3-p1",
      "4-r1",
      "6-p2",
      "7-r2",
    ])
    expect(ids(projectSpine(index, tip).spine)).toEqual([
      "1-q",
      "3-p1",
      "4-r1",
      "6-p2",
      "7-r2",
    ])
    expect(startsRun(index.entries[entryId("5-cards")])).toBe(false)
    expect(promptOf(index, tip)).toBe("6-p2")
  })

  test("pinnedInView: the newest cards entry on the path; none above the first", () => {
    expect(pinnedInView(index, entryId("7-r2"))).toEqual(second)
    expect(pinnedInView(index, entryId("4-r1"))).toEqual(first)
    expect(pinnedInView(index, entryId("1-q"))).toBeNull()
    expect(pinnedInView(index, null)).toBeNull()
  })

  test("pinnedInView: a compaction ends the walk; what its retained tail carries is in view, or none", () => {
    const carried: EntryLike = {
      ...entry("8-c", "7-r2", undefined, { type: "compaction" }),
      carried: first,
    }
    const after = entry("9-p3", "8-c", {
      role: "chat",
      content: "p3",
      author: "A",
    })
    const bare = entry("8-d", "7-r2", undefined, { type: "compaction" })
    const afterBare = entry("9-q", "8-d", {
      role: "chat",
      content: "q",
      author: "A",
    })
    const grown = indexTree(
      entriesOf([...list, carried, after, bare, afterBare]),
    )
    expect(pinnedInView(grown, entryId("9-p3"))).toEqual(first)
    // An entry above the compaction was summarised: out of view.
    expect(pinnedInView(grown, entryId("9-q"))).toBeNull()
  })

  test("pinnedInView on a branch's path: the parent's entry, read by another lane", () => {
    const branch = indexTree(
      entriesOf([
        ...list,
        entry("8-b", "3-p1", { role: "chat", content: "b", author: "A" }),
      ]),
    )
    expect(pinnedInView(branch, entryId("8-b"))?.lane).toBe(OTHER)
  })
})
