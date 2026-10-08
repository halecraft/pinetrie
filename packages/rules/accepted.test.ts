import {
  ACCEPTED_ACTIONS,
  type AcceptedRecord,
  type CommitId,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type LaneBase,
  type RevisionRecord,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  acceptedActionState,
  acceptedRefusal,
  baseMovedOn,
  nothingToPublish,
  parentNow,
  planAcceptedAction,
  planAcceptedRecord,
  planBegin,
  planParentUpdate,
  planPublishFinish,
  planUpdateFrom,
  publishUndone,
  publishWork,
} from "./index.ts"

describe("accepted work (ADR-0104)", () => {
  const facts = {
    commit: null,
    heads: "trunk()",
    log: null,
    wips: [],
    published: { commit: null, behind: 0, ahead: 0 },
    yours: {
      behind: 0,
      ahead: 0,
      catchUp: null,
      conflicts: { commits: 0, files: [] },
    },
  } as const
  const proposed = {
    heads: "trunk() | present(pinetrie-accepted)",
    log: "logged",
  }
  const record = (over: Partial<AcceptedRecord> = {}): AcceptedRecord => ({
    ...planAcceptedRecord({
      facts,
      repoConfig: {
        acceptedBookmark: "pinetrie-accepted",
        wipPrefix: "wip/",
        publish: "main",
        publishCatchesUp: true,
      },
      proposed,
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
      record().acceptedBookmark,
      record().wipPrefix,
      record().publish,
      record().publishCatchesUp,
    ]).toEqual(["pinetrie-accepted", "wip/", "main", true])
  })
  test("setup writes the bookmark at your @- and exactly the proposed heads and log", () => {
    expect(planAcceptedAction("setup", record())).toEqual({
      kind: "setup",
      acceptedBookmark: "pinetrie-accepted",
      heads: proposed.heads,
      log: "logged",
    })
  })
  test("setup runs whatever publish.catchUp says; a set line refuses it", () => {
    expect(
      planAcceptedAction("setup", record({ publishCatchesUp: false })).kind,
    ).toBe("setup")
    expect(
      planAcceptedAction("setup", record({ commit: commitId("c1") })).kind,
    ).toBe("refused")
  })
  test("land and follow are no setup or publish command (ADR-0090)", () => {
    expect(ACCEPTED_ACTIONS).toEqual(["setup", "publish"])
  })

  describe("publish (ADR-0076, ADR-0090)", () => {
    const main = commitId("m1")
    const yours = (
      over: Partial<AcceptedRecord["yours"]> = {},
    ): AcceptedRecord["yours"] => ({
      behind: 0,
      ahead: 0,
      catchUp: null,
      conflicts: { commits: 0, files: [] },
      ...over,
    })
    const at = (
      published: AcceptedRecord["published"],
      over: Partial<AcceptedRecord> = {},
    ) => record({ commit: commitId("c1"), published, ...over })
    const unpublished = { commit: main, behind: 2, ahead: 0 }
    const published = { commit: main, behind: 0, ahead: 0 }
    const preview = { changes: 4, conflicts: [], heads: 1 }
    const code = (r: AcceptedRecord) => {
      const s = acceptedActionState("publish", r)
      return s.kind === "refused" ? s.code : null
    }
    test("with publish.catchUp off it moves the publish bookmark alone, whatever the working copy holds", () => {
      const r = at(unpublished, {
        publishCatchesUp: false,
        yours: yours({
          behind: 2,
          ahead: 3,
          conflicts: { commits: 1, files: ["a"] },
        }),
      })
      expect(planAcceptedAction("publish", r)).toEqual({
        kind: "publish",
        acceptedBookmark: "pinetrie-accepted",
        publish: "main",
        catchUp: false,
        accept: false,
      })
      expect(publishWork(r)).toEqual({
        acceptedCommits: 2,
        yours: 0,
        catchUp: false,
      })
    })
    test("with publish.catchUp on it catches the working copy up and accepts your commits", () => {
      const r = at(unpublished, {
        yours: yours({ behind: 2, ahead: 1, catchUp: preview }),
      })
      expect(planAcceptedAction("publish", r)).toEqual({
        kind: "publish",
        acceptedBookmark: "pinetrie-accepted",
        publish: "main",
        catchUp: true,
        accept: true,
      })
      expect(publishWork(r)).toEqual({
        acceptedCommits: 2,
        yours: 1,
        catchUp: true,
      })
    })
    test("with nothing unpublished, your commits or files behind are still work", () => {
      expect(code(at(published, { yours: yours({ ahead: 1 }) }))).toBeNull()
      expect(
        code(at(published, { yours: yours({ behind: 1, catchUp: preview }) })),
      ).toBeNull()
    })
    test("refused, in order: no line, no bookmark, main ahead, your conflicts, no shared commit, nothing to do", () => {
      expect(code(record())).toBe(ERR.NOT_SET_UP)
      expect(code(at({ commit: null, behind: 0, ahead: 0 }))).toBe(
        ERR.NO_PUBLISH,
      )
      expect(
        code(
          at(
            { commit: main, behind: 3, ahead: 2 },
            { yours: yours({ conflicts: { commits: 1, files: [] } }) },
          ),
        ),
      ).toBe(ERR.NOT_FAST_FORWARD)
      for (const over of [
        { conflicts: { commits: 1, files: [] } },
        { conflicts: { commits: 0, files: ["a.txt"] } },
        { behind: 1, catchUp: { ...preview, conflicts: ["a.txt"] } },
      ])
        expect(code(at(unpublished, { yours: yours(over) }))).toBe(
          ERR.YOURS_CONFLICT,
        )
      expect(code(at(unpublished, { yours: yours({ behind: 1 }) }))).toBe(
        ERR.REFUSED,
      )
      expect(code(at(published))).toBe(ERR.REFUSED)
    })
    test("nothingToPublish is the rule's own nothing to do", () => {
      for (const r of [
        at(published),
        at(unpublished),
        at(published, { yours: yours({ ahead: 1 }) }),
        at(published, { publishCatchesUp: false, yours: yours({ ahead: 1 }) }),
      ])
        expect(nothingToPublish(publishWork(r))).toBe(code(r) === ERR.REFUSED)
    })
    test("lineRefusal words each refusal once, naming the bookmark, the counts and the files", () => {
      const r = at({ commit: main, behind: 3, ahead: 2 })
      expect(acceptedRefusal("publish", ERR.NOT_FAST_FORWARD, r)).toBe(
        "main has 2 commits accepted work doesn't: bring them into accepted work in jj first",
      )
      expect(acceptedRefusal("publish", ERR.NO_PUBLISH, r)).toBe(
        "this repo has no main bookmark to publish to",
      )
      expect(acceptedRefusal("publish", ERR.REFUSED, r)).toBe(
        "nothing to publish",
      )
      expect(
        acceptedRefusal(
          "publish",
          ERR.YOURS_CONFLICT,
          at(unpublished, {
            yours: yours({
              conflicts: { commits: 1, files: ["a", "b", "c", "d", "e"] },
            }),
          }),
        ),
      ).toBe("the working copy has conflicts in a, b, c and 2 more")
      expect(
        acceptedRefusal(
          "publish",
          ERR.YOURS_CONFLICT,
          at(unpublished, {
            yours: yours({
              behind: 1,
              catchUp: { ...preview, conflicts: ["x.ts"] },
            }),
          }),
        ),
      ).toBe("catching the working copy up would conflict in x.ts")
    })

    describe("planPublishFinish: the second round, from accepted work read after the catch-up", () => {
      const decision = {
        kind: "publish",
        acceptedBookmark: "pinetrie-accepted",
        publish: "main",
        catchUp: true,
        accept: false,
      } as const
      const after = (over: Partial<AcceptedRecord["yours"]> = {}, ahead = 0) =>
        at({ commit: main, behind: 2, ahead }, { yours: yours(over) })
      test.each([
        [
          "without a catch-up: the move as decided",
          {
            decision: { ...decision, catchUp: false, accept: true },
            after: after({ conflicts: { commits: 1, files: [] } }),
            op: null,
          },
          {
            kind: "move",
            acceptedBookmark: "pinetrie-accepted",
            publish: "main",
            accept: true,
          },
        ],
        [
          "your commits conflicted by the catch-up: reverted",
          {
            decision,
            after: after({ conflicts: { commits: 1, files: [] } }),
            op: "op1",
          },
          { kind: "undo", op: "op1", code: ERR.YOURS_CONFLICT },
        ],
        [
          "main moved meanwhile: reverted",
          { decision, after: after({}, 1), op: "op1" },
          { kind: "undo", op: "op1", code: ERR.NOT_FAST_FORWARD },
        ],
        [
          "your commits, read after the catch-up, move with accepted work",
          { decision, after: after({ ahead: 2 }), op: "op1" },
          {
            kind: "move",
            acceptedBookmark: "pinetrie-accepted",
            publish: "main",
            accept: true,
          },
        ],
        [
          "none: the publish bookmark alone",
          {
            decision: { ...decision, accept: true },
            after: after(),
            op: "op1",
          },
          {
            kind: "move",
            acceptedBookmark: "pinetrie-accepted",
            publish: "main",
            accept: false,
          },
        ],
      ] as const)("%s", (_, input, finish) => {
        expect(planPublishFinish(input)).toEqual(finish)
      })
    })
  })

  test("publishUndone: a reverted catch-up names the conflicts it would have left; main moving is worded as a refusal", () => {
    const after = record({
      commit: commitId("c1"),
      published: { commit: commitId("m1"), behind: 1, ahead: 1 },
      yours: {
        behind: 0,
        ahead: 2,
        catchUp: null,
        conflicts: { commits: 2, files: [] },
      },
    })
    expect(publishUndone(ERR.YOURS_CONFLICT, after)).toBe(
      "catching the working copy up would leave 2 commits of yours with conflicts",
    )
    expect(publishUndone(ERR.NOT_FAST_FORWARD, after)).toBe(
      acceptedRefusal("publish", ERR.NOT_FAST_FORWARD, after),
    )
  })
  test("movedOnLine names the base as catchUpName does", () => {
    expect(baseMovedOn({ kind: "accepted" })).toBe("accepted work has moved on")
    expect(baseMovedOn({ kind: "wip", bookmark: "wip/search" })).toBe(
      "wip/search has moved on",
    )
  })
})

describe("planBegin: accepted work, or a WIP's copy (ADR-0104)", () => {
  const L = commitId("l1")
  const wip = { commit: commitId("w1"), under: commitId("l0") }
  const begin = (
    base: string | null,
    facts: Parameters<typeof planBegin>[0]["facts"],
  ) =>
    planBegin({
      base,
      wipPrefix: "wip/",
      facts,
    })
  test("accepted work's commit by default", () => {
    expect(begin(null, { acceptedCommit: L, wip: null })).toEqual({
      kind: "accepted",
      commit: L,
    })
  })
  test("a WIP above accepted work: its copy on accepted commit under it", () => {
    expect(begin("wip/x", { acceptedCommit: L, wip })).toEqual({
      kind: "wip",
      bookmark: "wip/x",
      ...wip,
    })
  })
  test("no line: not_set_up; a base that is no WIP above accepted work: bad_base", () => {
    expect(begin(null, { acceptedCommit: null, wip: null })).toBe(
      ERR.NOT_SET_UP,
    )
    expect(begin("main", { acceptedCommit: L, wip })).toBe(ERR.BAD_BASE)
    expect(begin("wip/x", { acceptedCommit: L, wip: null })).toBe(ERR.BAD_BASE)
  })
})

describe("parentNow and planParentUpdate: the thread a lane branched from (ADR-0072)", () => {
  const P = threadIdFor("p")
  const L = threadIdFor("l")
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

describe("planUpdateFrom: always the base the thread follows (ADR-0104)", () => {
  const L = commitId("l1")
  const W = commitId("w1")
  const COPY = commitId("c1")
  const wipBase: LaneBase = {
    base: { kind: "wip", bookmark: "wip/x" },
    start: COPY,
    source: W,
  }
  const acceptedBase: LaneBase = {
    base: { kind: "accepted" },
    start: L,
    source: L,
  }
  const now = { commit: commitId("w2"), under: commitId("l0") }
  const from = (over: Partial<Parameters<typeof planUpdateFrom>[0]> = {}) =>
    planUpdateFrom({
      base: wipBase,
      state: "ok",
      toAccepted: false,
      acceptedCommit: L,
      wipNow: now,
      ...over,
    })
  const line = (mark: boolean) => ({
    kind: "accepted",
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
  test("a thread on accepted work, a lane with no base, and a landed WIP merge accepted work, marking no move", () => {
    expect(from({ base: acceptedBase, wipNow: null })).toEqual(line(false))
    expect(from({ base: null, wipNow: null })).toEqual(line(false))
    expect(from({ state: "landed", wipNow: null })).toEqual(line(false))
  })
  test("continue on accepted work marks a move from a WIP, and from no other base", () => {
    expect(from({ toAccepted: true })).toEqual(line(true))
    expect(from({ toAccepted: true, state: "landed" })).toEqual(line(true))
    expect(
      from({ toAccepted: true, base: acceptedBase, wipNow: null }),
    ).toEqual(line(false))
    expect(from({ toAccepted: true, base: null, wipNow: null })).toEqual(
      line(false),
    )
  })
  test("a gone WIP refuses until continued on accepted work; no line refuses", () => {
    expect(from({ state: "gone", wipNow: null })).toBe(ERR.BASE_GONE)
    expect(from({ state: "gone", wipNow: null, toAccepted: true })).toEqual(
      line(true),
    )
    expect(from({ acceptedCommit: null })).toBe(ERR.NOT_SET_UP)
  })
})
