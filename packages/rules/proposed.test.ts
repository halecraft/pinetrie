import {
  type AcceptanceDecision,
  type CommitId,
  commitId,
  ERR,
  type FilesTouched,
  type JjAcceptedRecord,
  type JjBaseRecord,
  type JjProposedChangesRecord,
  type Placed,
  type ProposedChangesGather,
  type ProposedChangesInRepo,
  type ProposedChangesNow,
  type ProposedChangesSeen,
  pointFromCommit,
  pointId,
  type RefreshFacts,
  type StackFacts,
  type StartRead,
  type ThreadName,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  ACCEPTED,
  BASE as BASE_RECORD,
  decodeStack,
  encodeUpdate,
  PROPOSED_CHANGES,
  planAcceptance,
  planDescribeAgain,
  planDescribeAsk,
  planDescribeSettle,
  planRebuild,
  planRefresh,
  planStack,
  planStackEnded,
  planWorkingCopyEdits,
  proposedChangesRecord,
  proposedChangesSeen,
  renderableMessage,
  setRecord,
} from "./index.ts"
import { latestWords } from "./latest-from.ts"
import {
  acceptanceDestinations,
  isAsShown,
  isProposedMoved,
} from "./proposed.ts"
import { decodeUpdate } from "./update.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada@x.io")
const TIP = commitId("t1")
const T2 = commitId("t2")
const BASE = commitId("b0")
const COPY = commitId("k1")

const proposed: JjProposedChangesRecord = {
  kind: "jj",
  lane: LANE,
  size: 1,
  stale: false,
  files: ["a.txt", "b.txt"],
  conflicts: [],
  startConflicts: [],
  workingCopyEdits: [],
  described: true,
  edited: false,
  bookmark: "pinetrie-proposed/t-1",
  acceptedAs: null,
  commits: [commitId("w1")],
  ledger: null,
  at: 10,
}

test("proposedChangesSeen: what an acceptance was shown is the record's ledger and whether it conflicted; no record shows none", () => {
  const ledger = { source: TIP, start: [BASE] }
  expect(
    proposedChangesSeen({ ...proposed, ledger, conflicts: ["a.txt"] }),
  ).toEqual({
    kind: "jj",
    ledger,
    conflicted: true,
  })
  expect(proposedChangesSeen(proposed)).toEqual({
    kind: "jj",
    ledger: null,
    conflicted: false,
  })
  expect(proposedChangesSeen(undefined)).toEqual({
    kind: "jj",
    ledger: null,
    conflicted: false,
  })
})

test("proposedChangesSeen: a folder record shows its two states", () => {
  expect(
    proposedChangesSeen({
      kind: "folder",
      lane: LANE,
      start: pointId("line-1"),
      tip: pointId("turn-1"),
      files: ["a.txt"],
      conflicts: [],
      description: null,
      at: 0,
    }),
  ).toEqual({
    kind: "folder",
    start: pointId("line-1"),
    tip: pointId("turn-1"),
    conflicted: false,
  })
})

describe("isAsShown", () => {
  const folder = {
    kind: "folder",
    start: pointId("line-1"),
    tip: pointId("turn-1"),
    conflicted: false,
  } as const
  const jj = {
    kind: "jj",
    ledger: { source: TIP, start: [BASE] },
    conflicted: false,
  } as const
  test("the same two states are as shown", () => {
    expect(isAsShown(folder, folder)).toBe(true)
  })
  test("accepted work moved, or the lane's tip, is not as shown", () => {
    expect(isAsShown({ ...folder, start: pointId("line-2") }, folder)).toBe(
      false,
    )
    expect(isAsShown({ ...folder, tip: pointId("turn-2") }, folder)).toBe(false)
  })
  test("a conflict now that was not shown is not as shown", () => {
    expect(isAsShown({ ...folder, conflicted: true }, folder)).toBe(false)
    expect(isAsShown(jj, { ...jj, conflicted: true })).toBe(true)
  })
  test("a seen value of the other kind is not as shown", () => {
    expect(isAsShown(folder, jj)).toBe(false)
    expect(isAsShown(jj, folder)).toBe(false)
  })
})

describe("planRefresh", () => {
  const host = { reached: true, othersChanged: false }
  const rev = (since = host) => ({ commit: TIP, changeId: "k", since })
  const read = (
    o: Partial<Extract<ProposedChangesInRepo, { kind: "present" }>> = {},
  ): ProposedChangesInRepo => ({
    kind: "present",
    bookmark: `pinetrie-proposed/t-1`,
    marked: true,
    revisions: [rev()],
    chained: true,
    ledger: { source: TIP, start: [BASE] },
    firstLine: "WIP (t-1): x",
    placed: true,
    onTarget: true,
    files: [],
    conflicts: [],
    startConflicts: [],
    ...o,
  })
  const facts = (
    proposed: ProposedChangesInRepo | null,
    tip = TIP,
    start: readonly CommitId[] | StartRead = [BASE],
    work: FilesTouched = "some",
    hostLeft = false,
  ): RefreshFacts =>
    "kind" in start
      ? start.kind === "untraced"
        ? { kind: "untraced", proposed, hostLeft }
        : {
            kind: "placed",
            place: placed(tip, start.start),
            work,
            proposed,
            hostLeft,
          }
      : { kind: "placed", place: placed(tip, start), work, proposed, hostLeft }
  const placed = (tip: CommitId, start: readonly CommitId[]): Placed => ({
    kind: "placed",
    tip,
    base: { base: { kind: "accepted" }, start: BASE, source: BASE },
    state: "ok",
    target: commitId("l0"),
    start,
  })
  /** What `planRefresh` decides, by its kind. */
  const plan = (f: RefreshFacts) => planRefresh(f).kind
  test("no proposed changes in your repo: build, unless the lane holds nothing you lack", () => {
    expect(plan(facts(null))).toBe("build")
    expect(plan(facts(null, TIP, [TIP]))).toBe("forget")
  })
  test("a lane whose work changes no file is never built, and its proposed changes are withdrawn unless you edited it", () => {
    expect(plan(facts(null, TIP, [BASE], "none"))).toBe("forget")
    expect(plan(facts(read(), TIP, [BASE], "none"))).toBe("withdraw")
    expect(plan(facts(read({ chained: false }), TIP, [BASE], "none"))).toBe(
      "leave",
    )
  })
  test("what jj could not tell never builds proposed changes, and keeps one that is there", () => {
    expect(plan(facts(null, TIP, [BASE], "unknown"))).toBe("forget")
    expect(plan(facts(read(), TIP, [BASE], "unknown"))).toBe("none")
    expect(plan(facts(read(), T2, [BASE], "unknown"))).toBe("rebuild")
  })
  test("an untraced start builds nothing, withdraws proposed changes, and leaves one you edited, or one divergent, untouched", () => {
    const untraced: StartRead = {
      kind: "untraced",
      acceptedThreadCommits: [BASE],
    }
    expect(plan(facts(null, TIP, untraced))).toBe("forget")
    expect(plan(facts(read(), TIP, untraced))).toBe("withdraw")
    expect(plan(facts(read({ chained: false }), TIP, untraced))).toBe(
      "untouched",
    )
    expect(
      plan(facts({ kind: "divergent", changeIds: ["k"] }, TIP, untraced)),
    ).toBe("untouched")
  })
  test("each decision carries what its steps need: the place, the proposed changes, the changes", () => {
    const at = placed(TIP, [BASE])
    expect(planRefresh(facts(null))).toEqual({ kind: "build", place: at })
    expect(planRefresh(facts(read(), T2))).toEqual({
      kind: "rebuild",
      place: placed(T2, [BASE]),
      proposed: read(),
    })
    expect(planRefresh(facts(read({ onTarget: false })))).toEqual({
      kind: "refresh",
      place: at,
      proposed: read({ onTarget: false }),
    })
    expect(
      planRefresh(facts({ kind: "divergent", changeIds: ["ka", "kb"] })),
    ).toEqual({ kind: "repair", place: at, changeIds: ["ka", "kb"] })
    expect(
      planRefresh({ kind: "archived", proposed: read(), hostLeft: false }),
    ).toEqual({
      kind: "withdraw",
      proposed: read(),
    })
  })
  test("an archived thread's proposed changes are withdrawn, an edited one too; with none, its record is forgotten", () => {
    expect(plan({ kind: "archived", proposed: read(), hostLeft: false })).toBe(
      "withdraw",
    )
    expect(
      plan({
        kind: "archived",
        proposed: read({ chained: false }),
        hostLeft: false,
      }),
    ).toBe("withdraw")
    expect(
      plan({
        kind: "archived",
        proposed: { kind: "divergent", changeIds: ["k"] },
        hostLeft: false,
      }),
    ).toBe("withdraw")
    expect(plan({ kind: "archived", proposed: null, hostLeft: false })).toBe(
      "forget",
    )
  })
  test("only the target moved: refresh; nothing moved: none", () => {
    expect(plan(facts(read({ onTarget: false })))).toBe("refresh")
    expect(plan(facts(read()))).toBe("none")
  })
  test("nothing moved, but the host's version lags: mark; an edited one is left unmarked", () => {
    expect(plan(facts(read({ marked: false })))).toBe("mark")
    expect(
      plan(
        facts(
          read({
            marked: false,
            revisions: [rev({ reached: true, othersChanged: true })],
          }),
        ),
      ),
    ).toBe("leave")
  })
  test("no proposed changes and none to build: the host's version left behind is forgotten with the record", () => {
    expect(planRefresh(facts(null, TIP, [TIP], "some", true))).toEqual({
      kind: "forget",
      hostLeft: true,
    })
    expect(planRefresh(facts(null, TIP, [TIP]))).toEqual({
      kind: "forget",
      hostLeft: false,
    })
    expect(
      planRefresh({ kind: "archived", proposed: null, hostLeft: true }),
    ).toEqual({ kind: "forget", hostLeft: true })
  })
  test("the lane moved on: single proposed changes are rebuilt, a stack goes stale", () => {
    expect(plan(facts(read(), T2))).toBe("rebuild")
    expect(plan(facts(read({ revisions: [rev(), rev()] }), T2))).toBe("stale")
  })
  test("where it starts moved (you accepted part of it): the same, or withdraw when nothing is left", () => {
    expect(plan(facts(read(), TIP, [T2]))).toBe("rebuild")
    expect(
      plan(
        facts(read({ ledger: { source: TIP, start: [BASE, T2] } }), TIP, [
          T2,
          BASE,
        ]),
      ),
    ).toBe("none")
    expect(plan(facts(read({ revisions: [rev(), rev()] }), TIP, [T2]))).toBe(
      "stale",
    )
    expect(plan(facts(read(), TIP, [TIP]))).toBe("withdraw")
  })
  test("proposed changes with no ledger, built before proposed changes carried one, reads as moved: it is followed once", () => {
    expect(plan(facts(read({ ledger: null })))).toBe("rebuild")
  })
  test("you edited it: a version of yours that changed a revision, a commit of yours between, or its bottom moved", () => {
    const changed = { reached: true, othersChanged: true }
    expect(plan(facts(read({ revisions: [rev(changed)] })))).toBe("leave")
    expect(plan(facts(read({ revisions: [rev(changed), rev()] }), T2))).toBe(
      "leave",
    )
    expect(plan(facts(read({ chained: false })))).toBe("leave")
    expect(plan(facts(read({ placed: false, onTarget: false })))).toBe("leave")
  })
  test("a revision the host never made is yours; a version only the host made is not", () => {
    expect(
      plan(
        facts(
          read({ revisions: [rev({ reached: false, othersChanged: false })] }),
        ),
      ),
    ).toBe("leave")
    expect(plan(facts(read(), T2))).toBe("rebuild")
  })
  test("divergent: repair, before anything else", () => {
    expect(
      plan(facts({ kind: "divergent", changeIds: ["k"] }, TIP, [TIP])),
    ).toBe("repair")
  })
})

describe("isWipLine, isProposedMoved, describeWanted", () => {
  const NAME = "t-1" as ThreadName
  const one = {
    kind: "present" as const,
    bookmark: "pinetrie-proposed/t-1",
    marked: true,
    revisions: [
      {
        commit: TIP,
        changeId: "k",
        since: { reached: true, othersChanged: false },
      },
    ],
    chained: true,
    ledger: { source: TIP, start: [BASE] },
    firstLine: "WIP (t-1): x",
    placed: true,
    onTarget: true,
    files: [],
    conflicts: [],
    startConflicts: [],
  }
  test("isProposedMoved: the tip, or the start as a set, against the ledger; no ledger is moved", () => {
    const ledger = { source: TIP, start: [BASE, T2] }
    expect(isProposedMoved(ledger, { tip: TIP, start: [T2, BASE] })).toBe(false)
    expect(isProposedMoved(ledger, { tip: T2, start: [T2, BASE] })).toBe(true)
    expect(isProposedMoved(ledger, { tip: TIP, start: [BASE] })).toBe(true)
    expect(isProposedMoved(null, { tip: TIP, start: [BASE] })).toBe(true)
  })
  test("describeWanted: one revision, not yours, on its WIP line unless forced", () => {
    const asks = (proposed: ProposedChangesInRepo | null, force: boolean) =>
      planDescribeAsk(
        {
          place: {
            kind: "placed",
            tip: TIP,
            base: { base: { kind: "accepted" }, start: BASE, source: BASE },
            state: "ok",
            target: T2,
            start: [BASE],
          },
          name: NAME,
          proposed,
          base: {
            kind: "jj",
            lane: LANE,
            base: { kind: "accepted" },
            start: BASE,
            state: "ok",
            getLatest: null,
            untraced: [],
            work: "some",
          },
        },
        force,
      ) !== null
    expect(asks(one, false)).toBe(true)
    expect(asks({ ...one, firstLine: "fix: x" }, false)).toBe(false)
    expect(asks({ ...one, firstLine: "fix: x" }, true)).toBe(true)
    expect(
      asks({ ...one, revisions: [...one.revisions, ...one.revisions] }, true),
    ).toBe(false)
    expect(asks({ ...one, chained: false }, true)).toBe(false)
    expect(asks(null, true)).toBe(false)
  })
})

describe("records", () => {
  test("proposed changes, accepted work and a base round-trip", () => {
    const o = setRecord(PROPOSED_CHANGES, proposed)
    expect([o.namespace, o.key]).toEqual(["pinetrie.proposed", LANE])
    expect(PROPOSED_CHANGES.decode(structuredClone(o.value), LANE)).toEqual(
      proposed,
    )
    expect(
      PROPOSED_CHANGES.decode({ ...proposed, size: 0 }, LANE),
    ).toBeUndefined()
    const line: JjAcceptedRecord = {
      kind: "jj",
      acceptedBookmark: "pinetrie-accepted",
      wipPrefix: "wip/",
      publish: "main",
      published: { commit: null, behind: 0, ahead: 0 },
      commit: COPY,
      heads: { current: null, proposed: "builtin_immutable_heads() | …" },
      log: { current: null, proposed: "builtin_log() | …" },
      unfinishedWork: [{ bookmark: "wip/x", commit: TIP, behind: 1, ahead: 2 }],
      workingCopy: {
        behind: 0,
        ahead: 0,
        getLatest: null,
        conflicts: { commits: 0, files: [] },
      },
      publishCatchesUp: true,
    }
    const l = setRecord(ACCEPTED, line)
    expect([l.namespace, l.key]).toEqual(["pinetrie.accepted", "accepted"])
    expect(ACCEPTED.decode(structuredClone(l.value), "accepted")).toEqual(line)
    const base: JjBaseRecord = {
      kind: "jj",
      lane: LANE,
      base: { kind: "unfinished", bookmark: "wip/x" },
      start: COPY,
      state: "ok",
      getLatest: { tip: TIP, to: COPY, files: ["a.txt"] },
      untraced: [TIP],
      work: "some",
    }
    const b = setRecord(BASE_RECORD, base)
    expect([b.namespace, b.key]).toEqual(["pinetrie.base", LANE])
    expect(BASE_RECORD.decode(structuredClone(b.value), LANE)).toEqual(base)
    // One stored before what catching up changes was read: dropped, so the
    // page reads it as unknown until the host writes it again.
    const {
      getLatest: _c,
      untraced: _u,
      ...before
    } = b.value as Record<string, unknown>
    expect(BASE_RECORD.decode(before, LANE)).toBeUndefined()
  })
  test("proposed changes stored before its commits were kept does not decode", () => {
    const { commits: _, ...before } = proposed
    expect(PROPOSED_CHANGES.decode(before, LANE)).toBeUndefined()
  })
})

describe("the update and stack messages", () => {
  const details = {
    lane: LANE,
    from: { kind: "accepted" as const },
    merged: pointFromCommit(COPY),
    commits: ["feat: yours"],
    files: ["a.txt", "c.txt"],
    by: ADA,
  }
  test("an update round-trips, shows one line, and tells the model what changed", () => {
    const m = encodeUpdate(details, 5)
    expect(decodeUpdate(structuredClone(m))).toEqual(details)
    expect(m.content).toContain("- c.txt")
    expect(renderableMessage(m)).toEqual({
      role: "update",
      content: "↓ got the latest from accepted work: 2 files changed",
      merged: [pointFromCommit(COPY)],
    })
    expect(m.content).toContain("Accepted work was merged into this thread")
    expect(m.details).toEqual(details)
    // One stored in an older shape does not decode, and the column leaves it out.
    const { from: _f, merged: _m, ...rest } = details
    const older = { ...rest, base: "accepted", line: true, copy: COPY }
    expect(decodeUpdate({ ...m, details: older })).toBeUndefined()
    const unfinished = {
      ...details,
      from: { kind: "unfinished" as const, bookmark: "wip/a" },
    }
    expect(renderableMessage(encodeUpdate(unfinished, 5))).toMatchObject({
      content: "↓ got the latest from wip/a: 2 files changed",
    })
    expect(encodeUpdate(unfinished, 5).content).toContain(
      "The work on wip/a was merged",
    )
  })
  test("an update from the thread it branched from names it, for the column and the model", () => {
    const fromParent = {
      ...details,
      from: {
        kind: "parent" as const,
        lane: threadIdFor("p"),
        name: "amber-fox" as ThreadName,
      },
    }
    const m = encodeUpdate(fromParent, 5)
    expect(decodeUpdate(structuredClone(m))).toEqual(fromParent)
    expect(renderableMessage(m)).toEqual({
      role: "update",
      content: "↓ got the latest from amber-fox: 2 files changed",
      merged: [pointFromCommit(COPY)],
    })
    expect(m.content).toContain(
      "The work of the thread this one branched from (amber-fox) was merged",
    )
  })
  test("an update that changed no file says so, and one with no commits says why", () => {
    const m = encodeUpdate({ ...details, commits: [], files: [] }, 5)
    expect(m.content).toContain(
      "Accepted work was merged into this thread's own copy. It changed no file in this copy, so what you read before still holds.",
    )
    expect(m.content).not.toContain("Files that changed")
    expect(m.content).not.toContain("changed under you")
    expect(m.content).toContain(
      "- only work this copy already holds, as accepted thread commits",
    )
    expect(renderableMessage(m)).toMatchObject({
      content: "↓ got the latest from accepted work: no file changed",
    })
  })
  test.each([
    [{ kind: "accepted" }, "Accepted work"],
    [{ kind: "unfinished", bookmark: "wip/a" }, "The work on wip/a"],
    [
      {
        kind: "parent",
        lane: threadIdFor("p"),
        name: "amber-fox" as ThreadName,
      },
      "The work of the thread this one branched from (amber-fox)",
    ],
  ] as const)("latestWords: %o", (from, words) => {
    expect(latestWords(from)).toBe(words)
  })
  test("a stack message names where it starts and ends, and the bookmark to set", () => {
    const m = planStack({
      skill: { path: "/s", content: "Split well.", hash: "h" },
      bookmark: "pinetrie/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      timestamp: 1,
    })
    expect(m.content).toContain("`b0`")
    expect(m.content).toContain("`t1`")
    expect(m.content).toContain("jj bookmark set pinetrie/t-1-stack")
    expect(decodeStack(structuredClone(m))).toMatchObject({
      tip: TIP,
      skill: { hash: "h" },
    })
    expect(renderableMessage(m)).toMatchObject({ role: "stack" })
    expect(m.content).not.toContain("What the person asked")
  })
  test("a split card's text is the stack's brief, under its own heading, last", () => {
    const m = planStack({
      skill: null,
      bookmark: "pinetrie/t-1-stack",
      details: { lane: LANE, start: [BASE], tip: TIP, by: ADA },
      intent: "  tests apart  ",
      timestamp: 1,
    })
    expect(m.content.endsWith("## What the person asked\n\ntests apart")).toBe(
      true,
    )
  })
})

describe("acceptanceDestinations", () => {
  const line = { kind: "accepted" } as const
  const unfinished = { kind: "unfinished", bookmark: "wip/x" } as const
  const of = (
    over: Partial<Parameters<typeof acceptanceDestinations>[0]> = {},
  ) =>
    acceptanceDestinations({
      base: line,
      state: "ok",
      acceptedBookmark: "pinetrie-accepted",
      conflicted: false,
      unfinishedAhead: 2,
      ...over,
    }).map(d => [d.bookmark, d.bringsAlong, d.final])
  test("a thread on accepted work: accepted work, final", () => {
    expect(of()).toEqual([["pinetrie-accepted", 0, true]])
  })
  test("a WIP thread: its WIP first, then accepted work with the WIP's commits", () => {
    expect(of({ base: unfinished })).toEqual([
      ["wip/x", 0, false],
      ["pinetrie-accepted", 2, true],
    ])
  })
  test("conflicted proposed changes never land on accepted work: only into a WIP", () => {
    expect(of({ conflicted: true })).toEqual([])
    expect(of({ base: unfinished, conflicted: true })).toEqual([
      ["wip/x", 0, false],
    ])
  })
  test("a landed WIP is accepted work's; a gone one has none", () => {
    expect(of({ base: unfinished, state: "landed" })).toEqual([
      ["pinetrie-accepted", 0, true],
    ])
    expect(of({ base: unfinished, state: "gone" })).toEqual([])
  })
})

describe("the proposed changes' policy over a gather", () => {
  const NAME = "amber-fox" as ThreadName
  const HOST_ONLY = { reached: true, othersChanged: false }
  const START = commitId("s0")
  const NEW_TIP = commitId("t9")
  const NOW_COMMIT = commitId("c5")
  const ACCEPTED_BASE = {
    base: { kind: "accepted" },
    start: START,
    source: START,
  } as const
  const at = (over: Partial<Placed> = {}): Placed => ({
    kind: "placed",
    tip: TIP,
    base: ACCEPTED_BASE,
    state: "ok",
    target: commitId("l1"),
    start: [START],
    ...over,
  })
  /** Proposed changes as your repo holds it: one revision, the host's, on its WIP line. */
  const read = (
    over: Partial<ProposedChangesNow> = {},
  ): ProposedChangesNow => ({
    kind: "present",
    bookmark: `pinetrie-proposed/${NAME}`,
    marked: true,
    revisions: [{ commit: NOW_COMMIT, changeId: "kxyz", since: HOST_ONLY }],
    chained: true,
    ledger: { source: TIP, start: [START] },
    firstLine: `WIP (${NAME}): fix it`,
    placed: true,
    onTarget: true,
    files: ["a.txt"],
    conflicts: [],
    startConflicts: [],
    ...over,
  })
  const baseRecord: JjBaseRecord = {
    kind: "jj",
    lane: LANE,
    base: { kind: "accepted" },
    start: START,
    state: "ok",
    getLatest: null,
    untraced: [],
    work: "some",
  }
  const gather = (
    over: Partial<ProposedChangesGather> = {},
  ): ProposedChangesGather => ({
    place: at(),
    name: NAME,
    proposed: read(),
    base: baseRecord,
    ...over,
  })

  describe("proposedChangesRecord: the page's cache, from the repo", () => {
    const record = (o = read(), tip = TIP) =>
      proposedChangesRecord({
        lane: LANE,
        name: NAME,
        proposed: o,
        place: { tip, start: [START] },
        editing: new Set(["a.txt", "elsewhere.txt"]),
        now: 7,
      })
    test("each revision's commit as it is now, and what the page shows", () => {
      expect(record()).toEqual({
        kind: "jj",
        lane: LANE,
        size: 1,
        stale: false,
        files: ["a.txt"],
        conflicts: [],
        startConflicts: [],
        workingCopyEdits: ["a.txt"],
        described: false,
        edited: false,
        bookmark: "pinetrie-proposed/amber-fox",
        acceptedAs: null,
        commits: [NOW_COMMIT],
        ledger: { source: TIP, start: [START] },
        at: 7,
      })
    })
    test("your edits are its files that @ changes, and only those", () => {
      expect(
        proposedChangesRecord({
          lane: LANE,
          name: NAME,
          proposed: read({ files: ["a.txt", "b.txt"] }),
          place: { tip: TIP, start: [START] },
          editing: new Set(["b.txt", "c.txt"]),
          now: 1,
        }).workingCopyEdits,
      ).toEqual(["b.txt"])
    })
    test("described once its first line is not the WIP line; edited once a version of yours changed it", () => {
      expect(record(read({ firstLine: "fix: it" })).described).toBe(true)
      const edited = read({
        revisions: [
          {
            commit: NOW_COMMIT,
            changeId: "kxyz",
            since: { reached: true, othersChanged: true },
          },
        ],
      })
      expect(record(edited).edited).toBe(true)
    })
    test("a stack is stale when the lane moved past its ledger; single proposed changes never are", () => {
      const stack = read({
        revisions: [
          { commit: commitId("b1"), changeId: "kb", since: HOST_ONLY },
          { commit: commitId("b2"), changeId: "kt", since: HOST_ONLY },
        ],
      })
      expect(record(stack, NEW_TIP).stale).toBe(true)
      expect(record(stack, TIP).stale).toBe(false)
      expect(record(read(), NEW_TIP).stale).toBe(false)
    })
  })

  test("planWorkingCopyEdits: each record's files that @ changes, open and held alike, until it is accepted", () => {
    const open = {
      ...proposed,
      files: ["a.txt", "b.txt"],
      workingCopyEdits: [],
    }
    const held = {
      ...proposed,
      lane: threadIdFor("2"),
      files: [],
      workingCopyEdits: ["x"],
    }
    const accepted = {
      ...proposed,
      lane: threadIdFor("3"),
      acceptedAs: "kt",
    }
    expect(
      planWorkingCopyEdits([open, held, accepted], new Set(["b.txt", "c.txt"])),
    ).toEqual([
      { ...open, workingCopyEdits: ["b.txt"] },
      { ...held, workingCopyEdits: [] },
    ])
  })

  describe("planAcceptance", () => {
    const o = read({
      revisions: [
        { commit: commitId("b1"), changeId: "kbot", since: HOST_ONLY },
        { commit: commitId("b2"), changeId: "ktop", since: HOST_ONLY },
      ],
    })
    const UNFINISHED_BASE = {
      base: { kind: "unfinished", bookmark: "wip/x" },
      start: START,
      source: START,
    } as const
    /** What the page drew: this proposed changes' ledger, not conflicting. */
    const SHOWN = { kind: "jj" as const, ledger: o.ledger, conflicted: false }
    const BOTH = new Set(["wip/x", "pinetrie-accepted"])
    const accept = (
      over: {
        readonly to?: string | null
        readonly below?: ReadonlySet<string>
        readonly gathered?: ProposedChangesGather | null
        readonly seen?: ProposedChangesSeen | null
        readonly proposed?: ProposedChangesInRepo
      } = {},
    ) =>
      planAcceptance({
        lane: LANE,
        gathered:
          over.gathered === undefined
            ? gather({
                place: at({ base: UNFINISHED_BASE }),
                proposed: over.proposed ?? o,
              })
            : over.gathered,
        seen: over.seen === undefined ? SHOWN : over.seen,
        acceptance: { unfinishedAhead: 2, below: over.below ?? BOTH },
        editing: new Set(),
        acceptedBookmark: "pinetrie-accepted",
        to: over.to ?? null,
        now: 9,
      })
    const outcome = (t: AcceptanceDecision) =>
      t.kind === "accept" ? t.destination : t.code
    test("the default destination is the WIP, the proposed changes' top, and the record marked accepted", () => {
      const record = proposedChangesRecord({
        lane: LANE,
        name: NAME,
        proposed: o,
        place: { tip: TIP, start: [START] },
        editing: new Set(),
        now: 9,
      })
      expect(accept()).toEqual({
        kind: "accept",
        name: NAME,
        bookmark: record.bookmark,
        destination: "wip/x",
        top: "ktop",
        accepted: { ...record, acceptedAs: "ktop", at: 9 },
      })
      expect(outcome(accept({ to: "pinetrie-accepted" }))).toBe(
        "pinetrie-accepted",
      )
    })
    test("refused in order: no proposed changes, a WIP gone, nothing shown, divergent, other work, no such destination", () => {
      expect(outcome(accept({ gathered: null }))).toBe(ERR.NO_PROPOSED_CHANGES)
      expect(outcome(accept({ gathered: gather({ proposed: null }) }))).toBe(
        ERR.NO_PROPOSED_CHANGES,
      )
      expect(
        outcome(
          accept({
            gathered: gather({
              place: { kind: "gone", tip: TIP, base: UNFINISHED_BASE },
            }),
            seen: null,
          }),
        ),
      ).toBe(ERR.BAD_DESTINATION)
      expect(
        outcome(
          accept({
            seen: null,
            proposed: { kind: "divergent", changeIds: ["k"] },
          }),
        ),
      ).toBe(ERR.NOT_AS_SHOWN)
      expect(
        outcome(accept({ proposed: { kind: "divergent", changeIds: ["k"] } })),
      ).toBe(ERR.NO_PROPOSED_CHANGES)
      expect(outcome(accept({ to: "main" }))).toBe(ERR.BAD_DESTINATION)
      expect(outcome(accept({ below: new Set(["pinetrie-accepted"]) }))).toBe(
        ERR.BAD_DESTINATION,
      )
    })
    test("conflicted proposed changes never go to accepted work; an untraced place is accepted where it sits", () => {
      const conflicted = { ...o, conflicts: ["a.txt"] }
      const shown = { kind: "jj" as const, ledger: o.ledger, conflicted: true }
      expect(outcome(accept({ proposed: conflicted, seen: shown }))).toBe(
        "wip/x",
      )
      expect(
        outcome(
          accept({
            proposed: conflicted,
            seen: shown,
            to: "pinetrie-accepted",
          }),
        ),
      ).toBe(ERR.BAD_DESTINATION)
      const untraced = gather({
        place: {
          kind: "untraced",
          tip: TIP,
          base: ACCEPTED_BASE,
          state: "ok",
          target: commitId("l1"),
        },
        proposed: o,
      })
      expect(outcome(accept({ gathered: untraced }))).toBe("pinetrie-accepted")
    })
    test.each([
      [
        "rebased onto a moved target, the same ledger",
        {
          proposed: read({
            ...o,
            revisions: [
              { commit: commitId("c9"), changeId: "ktop", since: HOST_ONLY },
            ],
          }),
        },
        "wip/x",
      ],
      [
        "edited by you, the same ledger",
        {
          proposed: read({
            ...o,
            revisions: [
              {
                commit: commitId("c9"),
                changeId: "ktop",
                since: { reached: true, othersChanged: true },
              },
            ],
          }),
        },
        "wip/x",
      ],
      [
        "another ledger: the lane moved on",
        {
          proposed: read({ ...o, ledger: { source: NEW_TIP, start: [START] } }),
        },
        ERR.NOT_AS_SHOWN,
      ],
      [
        "another start, the same source",
        {
          proposed: read({
            ...o,
            ledger: { source: TIP, start: [START, NEW_TIP] },
          }),
        },
        ERR.NOT_AS_SHOWN,
      ],
      [
        "the same start, in another order",
        {
          proposed: read({
            ...o,
            ledger: { source: TIP, start: [NEW_TIP, START] },
          }),
          seen: {
            kind: "jj",
            ledger: { source: TIP, start: [START, NEW_TIP] },
            conflicted: false,
          },
        },
        "wip/x",
      ],
      [
        "newly conflicting",
        { proposed: read({ ...o, conflicts: ["a.txt"] }) },
        ERR.NOT_AS_SHOWN,
      ],
      [
        "conflicting, as it was shown",
        {
          proposed: read({ ...o, conflicts: ["a.txt"] }),
          seen: { kind: "jj", ledger: o.ledger, conflicted: true },
        },
        "wip/x",
      ],
      [
        "shown no ledger, now one",
        { seen: { kind: "jj", ledger: null, conflicted: false } },
        ERR.NOT_AS_SHOWN,
      ],
    ] as const)(
      "an acceptance of the proposed changes it was shown: %s",
      (_, over, expected) => {
        expect(outcome(accept(over))).toBe(expected)
      },
    )
  })

  describe("planStackEnded and planRebuild: proposed changes built anew", () => {
    const span = { start: [commitId("s1")], tip: NEW_TIP }
    const sources = [
      { commit: commitId("r1"), description: "first" },
      { commit: commitId("r2"), description: "second" },
    ]
    const stack = (
      facts: StackFacts | "no-top" = { revisions: sources, differing: [] },
      gathered: ProposedChangesGather | null = gather(),
    ) => planStackEnded({ stack: span, facts, gathered })
    test("a stack of exactly the tip's files is built from its own start and tip, bottom first", () => {
      expect(stack()).toEqual({
        kind: "rebuild",
        name: NAME,
        place: at({ tip: NEW_TIP, start: [commitId("s1")] }),
        changeIds: ["kxyz"],
        sources,
      })
    })
    test("refused, in words the agent reads: no top, no revisions, other files, no lane, no name, a WIP gone", () => {
      const why = (d: ReturnType<typeof stack>) =>
        d.kind === "refused" ? d.why : "rebuild"
      expect(why(stack("no-top"))).toBe("the stack's bookmark was not set")
      expect(why(stack({ revisions: [], differing: [] }))).toBe(
        "the stack has no revisions",
      )
      expect(
        why(stack({ revisions: sources, differing: ["b.txt"] })),
      ).toContain("b.txt")
      expect(why(stack(undefined, null))).toBe(
        "the thread's lane is not in your repo",
      )
      expect(why(stack(undefined, gather({ name: undefined })))).toBe(
        "the thread has no name yet",
      )
      expect(
        why(
          stack(
            undefined,
            gather({ place: { kind: "gone", tip: TIP, base: ACCEPTED_BASE } }),
          ),
        ),
      ).toBe("the thread's base is gone: continue it on accepted work")
    })
    test("an untraced place accepts a stack: it brings its own start", () => {
      const untraced = gather({
        place: {
          kind: "untraced",
          tip: TIP,
          base: ACCEPTED_BASE,
          state: "ok",
          target: commitId("l1"),
        },
      })
      expect(stack(undefined, untraced).kind).toBe("rebuild")
    })
    test("planRebuild: the lane's tip as one revision on its WIP line, from a known start only", () => {
      expect(planRebuild(gather(), "WIP (amber-fox): x")).toEqual({
        kind: "rebuild",
        name: NAME,
        place: at(),
        changeIds: ["kxyz"],
        sources: [{ commit: TIP, description: "WIP (amber-fox): x" }],
      })
      expect(planRebuild(null, "")).toEqual({
        kind: "refused",
        why: ERR.NO_PROPOSED_CHANGES,
      })
      expect(
        planRebuild(
          gather({ place: { kind: "gone", tip: TIP, base: ACCEPTED_BASE } }),
          "",
        ),
      ).toEqual({ kind: "refused", why: ERR.BAD_DESTINATION })
      expect(
        planRebuild(
          gather({
            place: {
              kind: "untraced",
              tip: TIP,
              base: ACCEPTED_BASE,
              state: "ok",
              target: commitId("l1"),
            },
          }),
          "",
        ),
      ).toEqual({ kind: "refused", why: ERR.NO_PROPOSED_CHANGES })
    })
  })

  describe("a commit message: asked, then settled", () => {
    test("planDescribeAsk: the proposed changes' one revision while it is on its WIP line, or forced", () => {
      expect(planDescribeAsk(gather(), false)).toBe(NOW_COMMIT)
      expect(
        planDescribeAsk(
          gather({ proposed: read({ firstLine: "fix: x" }) }),
          false,
        ),
      ).toBeNull()
      expect(
        planDescribeAsk(
          gather({ proposed: read({ firstLine: "fix: x" }) }),
          true,
        ),
      ).toBe(NOW_COMMIT)
      expect(planDescribeAsk(gather({ name: undefined }), true)).toBeNull()
      expect(planDescribeAgain(gather())).toBeNull()
      expect(planDescribeAgain(gather({ proposed: null }))).toBe(
        ERR.NO_PROPOSED_CHANGES,
      )
    })
    test("planDescribeSettle: written only to the commit it was asked for, keeping the proposed changes' ledger", () => {
      expect(
        planDescribeSettle({
          gathered: gather(),
          asked: NOW_COMMIT,
          force: false,
        }),
      ).toEqual({
        name: NAME,
        place: at(),
        changeId: "kxyz",
        ledger: { source: TIP, start: [START] },
      })
      expect(
        planDescribeSettle({
          gathered: gather(),
          asked: commitId("other"),
          force: false,
        }),
      ).toBeNull()
      const edited = read({ chained: false })
      expect(
        planDescribeSettle({
          gathered: gather({ proposed: edited }),
          asked: NOW_COMMIT,
          force: true,
        }),
      ).toBeNull()
      expect(
        planDescribeSettle({
          gathered: gather({ proposed: read({ ledger: null }) }),
          asked: NOW_COMMIT,
          force: false,
        })?.ledger,
      ).toEqual({ source: TIP, start: [START] })
    })
  })
})
