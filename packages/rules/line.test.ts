import {
  type CommitId,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type LaneBase,
  type LineRecord,
  laneNameForThread,
  type RevisionRecord,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  lineActionState,
  lineRefusal,
  parentNow,
  planBegin,
  planLineAction,
  planLineRecord,
  planParentUpdate,
  planUpdateFrom,
} from "./index.ts"

describe("the line (ADR-0060)", () => {
  const facts = {
    commit: null,
    heads: "trunk()",
    log: null,
    wips: [],
    published: { commit: null, behind: 0, ahead: 0 },
    yours: {
      behind: 0,
      ahead: null,
      follow: null,
      conflicts: { commits: 0, files: [] },
    },
  } as const
  const proposed = { heads: "trunk() | present(pineta-onto)", log: "logged" }
  const record = (over: Partial<LineRecord> = {}): LineRecord => ({
    ...planLineRecord({
      facts,
      line: { onto: "pineta-onto", wipPrefix: "wip/", publish: "main" },
      proposed,
      commands: true,
    }),
    ...over,
  })
  test("planLineRecord shows your config beside what setting up would write", () => {
    expect(record().heads).toEqual({
      current: "trunk()",
      proposed: proposed.heads,
    })
    expect(record().log).toEqual({ current: null, proposed: "logged" })
    expect([
      record().onto,
      record().wipPrefix,
      record().publish,
      record().commands,
    ]).toEqual(["pineta-onto", "wip/", "main", true])
  })
  test("setup writes the bookmark at your @- and exactly the proposed heads and log", () => {
    expect(planLineAction("setup", record())).toEqual({
      kind: "setup",
      onto: "pineta-onto",
      heads: proposed.heads,
      log: "logged",
    })
  })
  test("a host that admits others refuses both; a set line refuses setup", () => {
    expect(planLineAction("setup", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(planLineAction("land", record({ commands: false }))).toEqual({
      kind: "refused",
      code: ERR.NOT_YOURS,
    })
    expect(
      planLineAction("setup", record({ commit: commitId("c1") })).kind,
    ).toBe("refused")
  })
  test("land: only with a line, and your work above it", () => {
    expect(planLineAction("land", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    const set = (ahead: number | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 0,
          ahead,
          follow: null,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("land", set(null)).kind).toBe("refused")
    expect(planLineAction("land", set(0)).kind).toBe("refused")
    expect(planLineAction("land", set(2))).toEqual({
      kind: "land",
      onto: "pineta-onto",
    })
  })
  test("follow: only with a line and a preview, the one you were shown; a conflict in it refuses nothing", () => {
    const preview = { changes: 1, conflicts: ["a.txt"], heads: 0 }
    const set = (follow: typeof preview | null) =>
      record({
        commit: commitId("c1"),
        yours: {
          behind: 2,
          ahead: 1,
          follow,
          conflicts: { commits: 0, files: [] },
        },
      })
    expect(planLineAction("follow", record())).toEqual({
      kind: "refused",
      code: ERR.NO_LINE,
    })
    expect(planLineAction("follow", set(null))).toEqual({
      kind: "refused",
      code: ERR.REFUSED,
    })
    expect(planLineAction("follow", set(preview))).toEqual({
      kind: "follow",
      onto: "pineta-onto",
    })
    expect(
      planLineAction("follow", { ...set(preview), commands: false }),
    ).toEqual({ kind: "refused", code: ERR.NOT_YOURS })
  })

  describe("publish (ADR-0076)", () => {
    const at = (published: LineRecord["published"], commands = true) =>
      record({ commit: commitId("c1"), published, commands })
    const main = commitId("m1")
    test("moves the publish bookmark forward to the line, as the host, on any host", () => {
      for (const commands of [true, false])
        expect(
          planLineAction(
            "publish",
            at({ commit: main, behind: 2, ahead: 0 }, commands),
          ),
        ).toEqual({ kind: "publish", onto: "pineta-onto", publish: "main" })
    })
    test("refused with no line, no bookmark, nothing unpublished, or commits the line lacks", () => {
      const code = (r: LineRecord) => {
        const s = lineActionState("publish", r)
        return s.kind === "refused" ? s.code : null
      }
      expect(code(record())).toBe(ERR.NO_LINE)
      expect(code(at({ commit: null, behind: 0, ahead: 0 }))).toBe(
        ERR.NO_PUBLISH,
      )
      expect(code(at({ commit: main, behind: 0, ahead: 0 }))).toBe(ERR.REFUSED)
      expect(code(at({ commit: main, behind: 3, ahead: 2 }))).toBe(
        ERR.NOT_FAST_FORWARD,
      )
    })
    test("the owner's three stay the host's alone", () => {
      for (const action of ["setup", "land", "follow"] as const)
        expect(lineActionState(action, record({ commands: false }))).toEqual({
          kind: "refused",
          code: ERR.NOT_YOURS,
        })
    })
    test("lineRefusal words each refusal once, naming the bookmark and counting", () => {
      const r = at({ commit: main, behind: 3, ahead: 2 })
      expect(lineRefusal("publish", ERR.NOT_FAST_FORWARD, r)).toBe(
        "main has 2 commits the project doesn't: bring them into the project first",
      )
      expect(lineRefusal("publish", ERR.NO_PUBLISH, r)).toBe(
        "this repo has no main bookmark to publish to",
      )
      expect(lineRefusal("publish", ERR.REFUSED, r)).toBe(
        "everything in the project is on main already",
      )
      expect(lineRefusal("land", ERR.NOT_YOURS, r)).toContain(
        "use jj on its machine",
      )
    })
  })
})

describe("planBegin: the line, or a WIP's copy (ADR-0060)", () => {
  const L = commitId("l1")
  const wip = { commit: commitId("w1"), under: commitId("l0") }
  const begin = (
    base: string | null,
    facts: Parameters<typeof planBegin>[0]["facts"],
  ) => planBegin({ base, onto: "pineta-onto", wipPrefix: "wip/", facts })
  test("the line's commit by default", () => {
    expect(begin(null, { line: L, wip: null })).toEqual({
      kind: "line",
      onto: "pineta-onto",
      commit: L,
    })
  })
  test("a WIP above the line: its copy on the line commit under it", () => {
    expect(begin("wip/x", { line: L, wip })).toEqual({
      kind: "wip",
      bookmark: "wip/x",
      ...wip,
    })
  })
  test("no line: no_line; a base that is no WIP above the line: bad_base", () => {
    expect(begin(null, { line: null, wip: null })).toBe(ERR.NO_LINE)
    expect(begin("main", { line: L, wip })).toBe(ERR.BAD_BASE)
    expect(begin("wip/x", { line: L, wip: null })).toBe(ERR.BAD_BASE)
  })
})

describe("parentNow and planParentUpdate: the thread a lane branched from (ADR-0072)", () => {
  const P = laneNameForThread("p")
  const L = laneNameForThread("l")
  const C = (n: number) => commitId(`c${n}`)
  const node = (
    id: string,
    parentId: string | null,
    role: string,
    merged?: CommitId[],
  ): EntryLike => ({
    id: entryId(id),
    parentId: parentId === null ? null : entryId(parentId),
    type: "message",
    message: { role, content: id, ...(merged === undefined ? {} : { merged }) },
  })
  // P's prompt and two turns; L branches below P's first turn and later
  // catches up with P's third commit; P goes on to a fourth, conflicted.
  const index = indexTree(
    Object.fromEntries(
      [
        node("1-p", null, "user"),
        node("2-m", "1-p", "assistant"),
        node("3-b", "2-m", "user"),
        node("4-u", "3-b", "update", [C(3)]),
        node("5-m", "2-m", "assistant"),
        node("6-m", "5-m", "assistant"),
      ].map(e => [e.id, e]),
    ),
  )
  const rec = (
    entry: string,
    lane: typeof P,
    commit: CommitId,
    conflicts: string[] = [],
  ): [ReturnType<typeof entryId>, RevisionRecord] => [
    entryId(entry),
    {
      entry: entryId(entry),
      lane,
      commit,
      snapshot: null,
      paths: [],
      conflicts,
    },
  ]
  const revisions = new Map([
    rec("1-p", P, C(1)),
    rec("2-m", P, C(2)),
    rec("3-b", L, C(2)),
    rec("5-m", P, C(3)),
    rec("6-m", P, C(4), ["a.txt"]),
  ])
  const names = new Map([[P, "amber-fox" as ThreadName]])
  const now = (lTip: string, pTip: string, named = names) =>
    parentNow({
      index,
      revisions,
      lane: L,
      tip: entryId(lTip),
      tipOf: lane =>
        lane === P ? entryId(pTip) : lane === L ? entryId(lTip) : null,
      names: named,
    })
  test("before any catch-up, the lane holds its fork commit", () => {
    expect(now("3-b", "6-m")).toEqual({
      kind: "parent",
      lane: P,
      name: "amber-fox",
      newest: C(4),
      caughtUpWith: C(2),
      conflicts: ["a.txt"],
    })
  })
  test("a catch-up's merged commit is what it caught up with", () => {
    expect(now("4-u", "6-m")?.caughtUpWith).toBe(C(3))
    expect(now("4-u", "5-m")).toMatchObject({
      newest: C(3),
      caughtUpWith: C(3),
    })
  })
  test("no parent: a lane that began at its base, or a parent with no name", () => {
    expect(
      parentNow({
        index,
        revisions,
        lane: P,
        tip: entryId("6-m"),
        tipOf: () => entryId("6-m"),
        names,
      }),
    ).toBeNull()
    expect(now("3-b", "6-m", new Map())).toBeNull()
  })
  test("planParentUpdate merges the parent's newest; nothing when held; refused without one, or while it runs", () => {
    expect(planParentUpdate(now("3-b", "6-m"), false)).toEqual({
      kind: "parent",
      lane: P,
      name: "amber-fox",
      commit: C(4),
      caughtUpWith: C(2),
    })
    expect(planParentUpdate(now("4-u", "5-m"), false)).toEqual({
      kind: "nothing",
    })
    expect(planParentUpdate(null, false)).toBe(ERR.NO_PARENT)
    expect(planParentUpdate(now("3-b", "6-m"), true)).toBe(ERR.PARENT_RUNNING)
  })
})

describe("planUpdateFrom: always the base the thread follows (ADR-0060)", () => {
  const L = commitId("l1")
  const W = commitId("w1")
  const COPY = commitId("c1")
  const wipBase: LaneBase = {
    base: { kind: "wip", bookmark: "wip/x" },
    start: COPY,
    source: W,
  }
  const lineBase: LaneBase = { base: { kind: "line" }, start: L, source: L }
  const now = { commit: commitId("w2"), under: commitId("l0") }
  const from = (over: Partial<Parameters<typeof planUpdateFrom>[0]> = {}) =>
    planUpdateFrom({
      onto: "pineta-onto",
      base: wipBase,
      state: "ok",
      toLine: false,
      line: L,
      wipNow: now,
      ...over,
    })
  const line = (mark: boolean) => ({
    kind: "line",
    onto: "pineta-onto",
    commit: L,
    mark,
  })
  test("a WIP thread merges a fresh copy of its WIP; nothing when it has not moved", () => {
    expect(from()).toMatchObject({ kind: "wip", bookmark: "wip/x", ...now })
    expect(from({ wipNow: { ...now, commit: W } })).toEqual({ kind: "nothing" })
  })
  test("a WIP's copy is made on the lane's last copy", () => {
    expect(from()).toEqual({ kind: "wip", bookmark: "wip/x", ...now, on: COPY })
  })
  test("a line thread, a lane with no base, and a landed WIP merge the line, marking no move", () => {
    expect(from({ base: lineBase, wipNow: null })).toEqual(line(false))
    expect(from({ base: null, wipNow: null })).toEqual(line(false))
    expect(from({ state: "landed", wipNow: null })).toEqual(line(false))
  })
  test("continue on the line marks a move from a WIP, and from no other base", () => {
    expect(from({ toLine: true })).toEqual(line(true))
    expect(from({ toLine: true, state: "landed" })).toEqual(line(true))
    expect(from({ toLine: true, base: lineBase, wipNow: null })).toEqual(
      line(false),
    )
    expect(from({ toLine: true, base: null, wipNow: null })).toEqual(
      line(false),
    )
  })
  test("a gone WIP refuses until continued on the line; no line refuses", () => {
    expect(from({ state: "gone", wipNow: null })).toBe(ERR.BASE_GONE)
    expect(from({ state: "gone", wipNow: null, toLine: true })).toEqual(
      line(true),
    )
    expect(from({ line: null })).toBe(ERR.NO_LINE)
  })
})
