import { describe, expect, test } from "vitest"
import {
  agentActivity,
  ancestry,
  atEntry,
  branchColors,
  type ChatMode,
  type EntryLike,
  entryId,
  followTip,
  indexTree,
  type LaneName,
  laneNameForThread,
  PENDING_TRACK,
  type Position,
  projectColumns,
  projectRail,
  ROOT,
  threadOf,
  writerId,
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
  test("roots, orphans and leaves are reported", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "8-r": null }),
    })
    expect([i.roots, i.orphans]).toEqual([["1-t1", "8-r"], ["9-x"]])
    expect(i.leaves).toEqual(["3-t3", "5-a2", "7-b2", "8-r", "9-x"])
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
  test("with nothing chosen, follows the newest leaf overall", () => {
    expect(followTip(indexTree(entries), null)).toBe("4-a3")
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

describe("projectRail", () => {
  const rows = projectRail(indexTree(forks))
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
    expect(projectRail(indexTree(shuffled))).toEqual(rows)
  })
  test("each root starts a track, reusing tracks its predecessors freed", () => {
    const two = projectRail(indexTree({ ...forks, ...tree({ "8-r1": null }) }))
    expect(two.find(r => r.id === "8-r1")).toMatchObject({
      track: 0,
      parentId: null,
    })
  })
  test("a non-message entry has no row; its child attaches to the message above", () => {
    const withCompaction = {
      ...forks,
      "8-c": { id: "8-c", parentId: "3-t3", type: "compaction" },
      ...tree({ "9-after": "8-c" }),
    }
    const r = projectRail(indexTree(withCompaction))
    expect(r.some(x => x.id === "8-c")).toBe(false)
    expect(r.find(x => x.id === "9-after")).toMatchObject({
      parentId: "3-t3",
      track: 0,
    })
  })
})

describe("colour and the agent", () => {
  const i = indexTree(forks)
  const rail = projectRail(i)
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
  test("the agent is idle with no running lane; each running lane reads its own path", () => {
    expect(agentActivity(i, [])).toEqual([])
    const runs = agentActivity(i, [
      { lane: laneNameForThread("a"), tip: "5-a2" },
      { lane: laneNameForThread("b"), tip: "7-b2" },
      { lane: laneNameForThread("new"), tip: null },
    ])
    expect(runs.map(r => [r.lane, [...r.path]])).toEqual([
      ["t-a", ["5-a2", "4-a1", "1-t1"]],
      ["t-b", ["7-b2", "6-b1", "2-t2", "1-t1"]],
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
