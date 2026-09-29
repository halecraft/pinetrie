import { describe, expect, test } from "vitest"
import {
  agentActivity,
  ancestry,
  applyEdits,
  atEntry,
  branchColors,
  type ChatMode,
  compactRail,
  type EntryLike,
  entryId,
  followTip,
  indexTree,
  type LaneName,
  laneNameForThread,
  PENDING_TRACK,
  type Position,
  planStop,
  projectColumns,
  projectRail,
  projectSpine,
  type RailItem,
  ROOT,
  rootOf,
  runSpan,
  tailEdit,
  threadOf,
  toolLabel,
  writerId,
  writersOf,
} from "./index.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (
  parents: Record<string, string | null>,
): Record<string, EntryLike> =>
  Object.fromEntries(
    Object.entries(parents).map(([id, parentId]) => [
      id,
      {
        id,
        parentId,
        type: "message",
        message: { role: "chat", content: id, author: "A" },
      },
    ]),
  )

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
    const shuffled = Object.fromEntries(Object.entries(forks).toReversed())
    expect(indexTree(shuffled).childrenOf.get("1-t1")).toEqual(["2-t2", "4-a1"])
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
    expect(rootOf(i, "7-b2")).toBe("1-t1")
    expect(rootOf(i, "1-t1")).toBe("1-t1")
    expect(rootOf(i, "a-y")).toBe("9-x")
    expect(rootOf(i, "nope")).toBeNull()
  })
  test("a cycle stops ancestry and is reported", () => {
    const cyclic = tree({ x: "y", y: "x" })
    expect(ancestry(indexTree(cyclic), "x")).toEqual({
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
    expect(followTip(indexTree(entries), "2-a2")).toBe("4-a3")
  })
  test("never jumps to a branch that is not below you", () => {
    const newer = { ...entries, ...tree({ "5-b3": "3-b2" }) }
    expect(followTip(indexTree(newer), "2-a2")).toBe("4-a3")
  })
  test("a cycle stops the walk rather than spinning", () => {
    expect(followTip(indexTree(tree({ w: "x", x: "y", y: "x" })), "z")).toBe(
      "z",
    )
  })
  test("walking down from an entry on a cycle ends", () => {
    // Going down, a cycle is reachable only from inside it: each entry has one
    // parent, so no chain leaves a cycle to reach it from outside.
    // Every entry on a cycle has a child, so there is no leaf below: `at` stands.
    expect(followTip(indexTree(tree({ x: "y", y: "x" })), "x")).toBe("x")
  })
})

describe("projectColumns", () => {
  const i = indexTree(forks)
  test("a first column is its whole path", () => {
    const [c] = projectColumns(i, [{ anchor: "3-t3" }])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      null,
      ["1-t1", "2-t2", "3-t3"],
    ])
  })
  test("a branch starts after the deepest message it shares with ANY column to its left", () => {
    const [, a, b] = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "4-a1" },
      { anchor: "6-b1" },
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
      { anchor: "4-a1" },
      { anchor: "3-t3" },
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
      { anchor: "3-t3" },
      { anchor: "8-r1" },
    ])
    expect([c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([null, ["8-r1", "9-r2"]])
  })
  test("a pinned column (fresh, or bound to a lane) ends at its anchor and follows nothing", () => {
    const [, c] = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "2-t2", pinned: true },
    ])
    expect([c?.tipId, c?.forkFrom, ids(c?.nodes ?? [])]).toEqual([
      "2-t2",
      "2-t2",
      [],
    ])
    // A fresh column at the root: nothing at all, and no fork.
    const [, root] = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: null, pinned: true },
    ])
    expect([root?.tipId, root?.forkFrom, root?.nodes]).toEqual([null, null, []])
  })
})

describe("writersOf", () => {
  test("each writer once, in order of their first message", () => {
    const ada = writerId("w-ada")
    const bea = writerId("w-bea")
    const by = (writer: typeof ada) => ({ role: "chat", author: "", writer })
    const i = indexTree({
      "1-a": { id: "1-a", parentId: null, type: "message", message: by(bea) },
      "2-b": { id: "2-b", parentId: "1-a", type: "message", message: by(ada) },
      "3-c": { id: "3-c", parentId: "2-b", type: "message", message: by(bea) },
      "4-d": { id: "4-d", parentId: "3-c", type: "message" },
    })
    expect(writersOf(i, ["4-d", "3-c", "2-b", "1-a"])).toEqual([bea, ada])
    expect(writersOf(i, ["3-c", "2-b"])).toEqual([ada, bea])
  })
})

describe("projectRail", () => {
  const rows = projectRail(indexTree(forks), "1-t1")
  const trackOf = (id: string) => rows.find(r => r.id === id)?.track
  test("the oldest child continues its parent's track; a younger one takes a new track", () => {
    expect([trackOf("1-t1"), trackOf("2-t2"), trackOf("3-t3")]).toEqual([
      0, 0, 0,
    ])
    expect(trackOf("4-a1")).toBe(1)
    expect(trackOf("6-b1")).toBe(2)
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
      parentTrack: 0,
    })
  })
  test("the same entries in another insertion order give the same rows", () => {
    const shuffled = Object.fromEntries(Object.entries(forks).toReversed())
    expect(projectRail(indexTree(shuffled), "1-t1")).toEqual(rows)
  })
  test("draws only its root's tree, from track 0", () => {
    const i = indexTree({ ...forks, ...tree({ "8-r1": null, "9-r2": "8-r1" }) })
    expect(ids(projectRail(i, "8-r1"))).toEqual(["8-r1", "9-r2"])
    expect(projectRail(i, "8-r1")[0]).toMatchObject({
      track: 0,
      parentId: null,
    })
    expect(ids(projectRail(i, "1-t1"))).toEqual(ids(rows))
  })
  test("a non-message entry has no row; its child attaches to the message above", () => {
    const withCompaction = {
      ...forks,
      "8-c": { id: "8-c", parentId: "3-t3", type: "compaction" },
      ...tree({ "9-after": "8-c" }),
    }
    const r = projectRail(indexTree(withCompaction), "1-t1")
    expect(r.some(x => x.id === "8-c")).toBe(false)
    expect(r.find(x => x.id === "9-after")).toMatchObject({
      parentId: "3-t3",
      track: 0,
    })
  })
})

describe("compactRail", () => {
  const pad = (n: number) => String(n).padStart(3, "0")
  const e = (
    id: string,
    parentId: string | null,
    message: Record<string, unknown>,
  ): [string, EntryLike] => [id, { id, parentId, type: "message", message }]
  /**
   * A person's question, `steps` agent messages that each call `read` and get
   * a result, and a reply. Ids sort in the order written. Step k is
   * `${pad(2k)}-s`, its result `${pad(2k + 1)}-r`.
   */
  const loop = (steps: number, failAt?: number): Record<string, EntryLike> => {
    const out: [string, EntryLike][] = [e("000-q", null, { role: "user" })]
    let parent = "000-q"
    for (let k = 1; k <= steps; k += 1) {
      const step = `${pad(2 * k)}-s`
      const result = `${pad(2 * k + 1)}-r`
      out.push(
        e(step, parent, {
          role: "assistant",
          content: [
            { type: "toolCall", id: `c${k}`, name: "read", arguments: {} },
          ],
        }),
        e(result, step, {
          role: "toolResult",
          toolCallId: `c${k}`,
          content: "",
          isError: k === failAt,
        }),
      )
      parent = result
    }
    out.push(e("999-a", parent, { role: "assistant", content: "done" }))
    return Object.fromEntries(out)
  }
  const steps = (n: number) =>
    Array.from({ length: n }, (_, k) => `${pad(2 * (k + 1))}-s`)
  const compact = (
    entries: Record<string, EntryLike>,
    root: string,
    keep: readonly string[] = [],
  ) => {
    const i = indexTree(entries)
    return compactRail(i, projectRail(i, root), new Set(keep))
  }
  const shape = (items: readonly RailItem[]) =>
    items.map(it => (it.kind === "dot" ? it.ids[0] : [...it.ids]))

  test("an agent loop between a question and its reply is one run", () => {
    const items = compact(loop(12), "000-q")
    expect(shape(items)).toEqual(["000-q", steps(12), "999-a"])
    expect(items[1]).toMatchObject({
      kind: "run",
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
  test("roots, forks, branches and thread ends are never in a run", () => {
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
  test("a kept message splits a run around it", () => {
    const [a, b] = [steps(12).slice(0, 5), steps(12).slice(6)]
    expect(shape(compact(loop(12), "000-q", ["012-s"]))).toEqual([
      "000-q",
      a,
      "012-s",
      b,
      "999-a",
    ])
  })
  test("a failed call counts, its result below the run's last message included", () => {
    const run = (failAt: number) =>
      compact(loop(12, failAt), "000-q").find(it => it.kind === "run")
    expect(run(3)).toMatchObject({ stats: { calls: 12, failed: 1 } })
    expect(run(12)).toMatchObject({ stats: { calls: 12, failed: 1 } })
  })
  test("a run's span is one row, and one more per digit of its size", () => {
    expect([3, 9, 10, 99, 100].map(runSpan)).toEqual([2, 2, 3, 3, 4])
    expect(compact(loop(100), "000-q")[1]).toMatchObject({ span: 4 })
  })
  test("every row is in exactly one item, in order, and slots add up", () => {
    const i = indexTree({ ...loop(12), ...tree({ "005-x": "004-s" }) })
    const rows = projectRail(i, "000-q")
    const items = compactRail(i, rows, new Set())
    expect(items.flatMap(it => it.ids)).toEqual(rows.map(r => r.id))
    for (const [k, it] of items.entries())
      expect(it.slot).toBe(
        k === 0 ? 0 : (items[k - 1]?.slot ?? 0) + (items[k - 1]?.span ?? 0),
      )
  })
  test("a run counts the messages people wrote, and who, in order", () => {
    const ada = writerId("w-ada")
    const bea = writerId("w-bea")
    const chat = (writer: typeof ada) => ({ role: "chat", author: "", writer })
    const agent = { role: "assistant", content: "ok" }
    const items = compact(
      Object.fromEntries([
        e("01", null, chat(ada)),
        e("02", "01", chat(bea)),
        e("03", "02", agent),
        e("04", "03", chat(ada)),
        e("05", "04", agent),
        e("06", "05", chat(bea)),
      ]),
      "01",
    )
    expect(items[1]).toMatchObject({
      ids: ["02", "03", "04", "05"],
      stats: { people: 2, writers: [bea, ada], calls: 0 },
    })
  })
})

describe("colour and the agent", () => {
  const i = indexTree(forks)
  const rail = projectRail(i, "1-t1")
  test("a column's colour is its last message's track; its fork dot matches", () => {
    const cols = projectColumns(i, [
      { anchor: "3-t3" },
      { anchor: "4-a1" },
      { anchor: "6-b1" },
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
      { anchor: "3-t3" },
      { anchor: "2-t2", pinned: true },
    ])
    expect(branchColors(rail, cols).track).toEqual([0, PENDING_TRACK])
  })
  test("the agent is idle with no running lane; a lane runs once it has a tip", () => {
    expect(agentActivity([])).toEqual([])
    const runs = agentActivity([
      { lane: laneNameForThread("a"), tip: "5-a2" },
      { lane: laneNameForThread("b"), tip: "7-b2" },
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
    extra: Record<string, unknown>,
  ): [string, EntryLike] => [
    id,
    {
      id,
      parentId,
      type: "message",
      message: { role: "chat", content: id, ...extra },
    },
  ]
  const entries = Object.fromEntries([
    say("1-q", null, { writer: "w-wu", compelled: true }),
    [
      "2-r",
      {
        id: "2-r",
        parentId: "1-q",
        type: "message",
        message: { role: "assistant", content: "r" },
      },
    ],
    say("3-plain", "2-r", { writer: "w-bo", compelled: false }),
    say("4-mine", "3-plain", { writer: "w-wu", compelled: true }),
  ]) as Record<string, EntryLike>
  const at = (id: string) => atEntry(entryId(id))

  const me = writerId("wu")
  const lane = (tip: string | null, name = "x") => ({
    name: laneNameForThread(name),
    tip,
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
      ...Object.fromEntries([
        say("6-next", "4-mine", { writer: "w-wu", compelled: false }),
        say("7-conv", "4-mine", { writer: "w-bo", compelled: false }),
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
      ...Object.fromEntries([
        say("5-theirs", "4-mine", { writer: "w-bo", compelled: true }),
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
      ...Object.fromEntries([
        say("5-fork", "2-r", { writer: "w-bo", compelled: true }),
        say("6-mine", "4-mine", { writer: "w-wu", compelled: false }),
      ]),
    })
    expect(threadOf(forked, [], send(at("1-q")))).toMatchObject({
      end: at("6-mine"),
      race: null,
    })
  })
})

describe("tool calls: paired with their results on the path", () => {
  const e = (
    id: string,
    parentId: string | null,
    message: Record<string, unknown>,
  ): [string, EntryLike] => [id, { id, parentId, type: "message", message }]
  const call = (id: string, name: string, args: unknown) => ({
    type: "toolCall",
    id,
    name,
    arguments: args,
  })
  const entries = Object.fromEntries([
    e("1-q", null, { role: "user", content: "what is in notes?" }),
    e("2-a", "1-q", {
      role: "assistant",
      content: [call("c1", "read", { path: "notes.txt" })],
    }),
    e("3-r", "2-a", {
      role: "toolResult",
      toolCallId: "c1",
      content: [{ type: "text", text: "MANGO" }],
      isError: false,
    }),
    e("4-a", "3-r", { role: "assistant", content: "It says MANGO." }),
    // A sibling branch answering the same call id: not on the main path.
    e("5-r", "2-a", {
      role: "toolResult",
      toolCallId: "c1",
      content: [{ type: "text", text: "elsewhere" }],
      isError: true,
    }),
  ])
  const i = indexTree(entries)

  test("a call and its result on one path pair; a message with only calls keeps them", () => {
    const { spine } = projectSpine(i, "4-a")
    expect(spine.map(n => n.id)).toEqual(["1-q", "2-a", "4-a"])
    expect(spine[1]?.toolCalls).toEqual([
      {
        id: "c1",
        name: "read",
        label: "read notes.txt",
        result: { text: "MANGO", isError: false },
      },
    ])
  })
  test("a result off the path does not pair", () => {
    // Path to 5-r: its result pairs; path to 2-a alone: no result yet.
    expect(
      projectSpine(i, "2-a").spine[1]?.toolCalls?.[0]?.result,
    ).toBeUndefined()
    expect(projectSpine(i, "5-r").spine[1]?.toolCalls?.[0]?.result).toEqual({
      text: "elsewhere",
      isError: true,
    })
  })
  test("a branch's message count ignores tool results", () => {
    const { spine } = projectSpine(i, "1-q")
    expect(spine[0]?.branches).toEqual([
      { rootId: "2-a", messageCount: 2, noteCount: 0 },
    ])
  })
})

test("planStop: abort a running lane; an idle one is already stopped; an unknown one is refused", () => {
  const lane = (running: boolean) => ({
    name: laneNameForThread("s"),
    tip: null,
    running,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
  })
  expect(planStop([lane(true)], laneNameForThread("s"))).toBe("abort")
  expect(planStop([lane(false)], laneNameForThread("s"))).toBe("idle")
  expect(planStop([lane(true)], laneNameForThread("other"))).toBe("unknown")
})

describe("toolLabel and tailEdit", () => {
  test("toolLabel names what the call touches", () => {
    expect(toolLabel("read", { path: "a.ts" })).toBe("read a.ts")
    expect(toolLabel("bash", { command: "pnpm test\necho done" })).toBe(
      "bash pnpm test",
    )
    expect(toolLabel("mystery", { x: 1 })).toBe("mystery")
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
