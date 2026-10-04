import {
  BASE_SNAPSHOT,
  type CommitId,
  commitId,
  type EntryLike,
  ERR,
  entryId,
  indexTree,
  type LandingRecord,
  type LaneBase,
  laneNameForThread,
  type RevisionRecord,
  rootIdFor,
  snapshotId,
  type ThreadName,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type ConflictFile,
  forkPoint,
  LAND_TYPE,
  LANDING,
  LANE as LANE_RECORD,
  landingOutcome,
  landingRecord,
  PROJECT,
  parentNow,
  planBegin,
  planParentUpdate,
  planResolution,
  planRetention,
  planTurnRecord,
  planUpdateFrom,
  REVISION,
  recordsOf,
  renderableMessage,
  setRecord,
  showHostWorkingCopy,
} from "./index.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada")
const C1 = commitId("c1")
const C2 = commitId("c2")

describe("records: one spec each, total decoders", () => {
  const lane = {
    lane: LANE,
    root: rootIdFor("test-root"),
    work: { kind: "own" as const },
    by: ADA,
    createdAt: 1,
  }
  const revision = {
    entry: entryId("e1"),
    lane: LANE,
    commit: C1,
    snapshot: snapshotId("e1"),
    paths: ["a.txt", "d/c é.txt"],
    conflicts: ["b.txt"],
  }
  const landing: LandingRecord = {
    id: "l1",
    lane: LANE,
    prompt: entryId("e2"),
    state: "resolved",
    by: ADA,
    at: 2,
  }
  const project = {
    kind: "lanes" as const,
    root: "/p",
    rootDefault: "own" as const,
  }
  test("each record round-trips, keyed as its reader expects", () => {
    const l = setRecord(LANE_RECORD, lane)
    expect([l.namespace, l.key, LANE_RECORD.decode(l.value, l.key)]).toEqual([
      "pineta.lane",
      LANE,
      lane,
    ])
    const r = setRecord(REVISION, revision, rootIdFor("test-root"))
    expect([r.key, REVISION.decode(r.value, r.key)]).toEqual(["e1", revision])
    const g = setRecord(LANDING, landing)
    expect([g.key, LANDING.decode(g.value, g.key)]).toEqual(["l1", landing])
    const p = setRecord(PROJECT, project)
    expect(PROJECT.decode(p.value, p.key)).toEqual(project)
  })
  test("a direct lane's prompt records no commit and no disk, and that decodes", () => {
    expect(
      REVISION.decode({ ...revision, commit: null, snapshot: null }, "e1"),
    ).toEqual({ ...revision, commit: null, snapshot: null })
  })
  test("a record from before lane containers has no snapshot key: it decodes as none", () => {
    const { snapshot: _, ...old } = revision
    expect(REVISION.decode(old, "e1")).toEqual({ ...old, snapshot: null })
  })
  test("a record from before conflicts were recorded decodes with none (ADR-0072)", () => {
    const { conflicts: _, ...old } = revision
    expect(REVISION.decode(old, "e1")).toEqual({ ...old, conflicts: [] })
  })
  test("a project record from before lane containers is dropped, and rewritten at start", () => {
    expect(
      PROJECT.decode(
        { kind: "workspaces", root: "/p", rootDefault: "own" },
        "project",
      ),
    ).toBeUndefined()
  })
  test("malformed values are dropped, never thrown", () => {
    const other = laneNameForThread("other")
    expect([
      ...recordsOf(LANE_RECORD, [
        { key: other, value: { ...lane, work: { kind: "direct" } } },
        { key: "main", value: lane },
        { key: other, value: 3 },
        { key: LANE, value: lane },
      ]).values(),
    ]).toEqual([lane])
  })
})

describe("landing", () => {
  test("landingOutcome: the agent can always ask; conflicts left are never resolved", () => {
    expect(landingOutcome({ askedForGuidance: false, conflictsLeft: 0 })).toBe(
      "resolved",
    )
    expect(landingOutcome({ askedForGuidance: true, conflictsLeft: 0 })).toBe(
      "needs_you",
    )
    expect(landingOutcome({ askedForGuidance: false, conflictsLeft: 2 })).toBe(
      "needs_you",
    )
  })
  test("a resolution's record names its prompt, its landing, how it ended and who asked", () => {
    const ada = writerId("ada@example.com")
    expect(
      landingRecord({
        details: { landing: "l-1", by: ada },
        lane: laneNameForThread("0123456789abcdef"),
        prompt: entryId("e-7"),
        askedForGuidance: false,
        conflictsLeft: 1,
        now: 5,
      }),
    ).toEqual({
      id: "l-1",
      lane: laneNameForThread("0123456789abcdef"),
      prompt: entryId("e-7"),
      state: "needs_you",
      by: ada,
      at: 5,
    })
  })
})

describe("planTurnRecord: every prompt, and every turn with tool calls", () => {
  const S = snapshotId("e")
  const base = {
    entry: entryId("e"),
    lane: LANE,
    newest: C1,
    snapshot: S,
    toolCalls: false,
    own: true,
    paths: ["a.txt"],
    conflicts: ["x.txt"],
  }
  test("a prompt always gets a record: its disk, and a commit of edits, else the newest revision", () => {
    expect(planTurnRecord({ ...base, isPrompt: true, committed: C2 })).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
    })
    // The newest revision is what came before the prompt: no paths of its own.
    expect(
      planTurnRecord({ ...base, isPrompt: true, committed: null }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C1,
      snapshot: S,
      paths: [],
      // The newest revision's conflicts: a branch from the prompt clones it.
      conflicts: ["x.txt"],
    })
  })
  test("a turn with tool calls gets its disk, and a commit only when one was made", () => {
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: C2,
      }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C2,
      snapshot: S,
      paths: ["a.txt"],
      conflicts: ["x.txt"],
    })
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: null,
      }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: null,
      snapshot: S,
      paths: [],
      conflicts: [],
    })
  })
  test("a turn with no tool calls and nothing committed gets none", () => {
    expect(
      planTurnRecord({ ...base, isPrompt: false, committed: null }),
    ).toBeNull()
  })
  test("a lane working directly records its prompts with neither, and nothing else", () => {
    const direct = { ...base, own: false, snapshot: null, committed: null }
    expect(planTurnRecord({ ...direct, isPrompt: true })).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: null,
      snapshot: null,
      paths: [],
      conflicts: [],
    })
    expect(
      planTurnRecord({ ...direct, isPrompt: false, toolCalls: true }),
    ).toBeNull()
  })
})

describe("forkPoint: a snapshot to clone, and what to start on", () => {
  const S = snapshotId("e")
  const begin = {
    kind: "line",
    onto: "pineta-onto",
    commit: commitId("l1"),
  } as const
  test("from a turn: its snapshot and the commit above", () => {
    expect(
      forkPoint({
        above: { lane: LANE, commit: C2, commitLane: LANE, snapshot: S },
        begin,
      }),
    ).toEqual({ snapshot: S, start: { kind: "commits", commits: [C2] } })
  })
  test("from a lane before lane containers: the base snapshot at its commit", () => {
    expect(
      forkPoint({
        above: { lane: LANE, commit: C2, commitLane: LANE, snapshot: null },
        begin,
      }),
    ).toEqual({
      snapshot: BASE_SNAPSHOT,
      start: { kind: "commits", commits: [C2] },
    })
  })
  test("from nothing: the base snapshot, and where agent work begins (ADR-0060)", () => {
    expect(
      forkPoint({
        above: { lane: null, commit: null, commitLane: null, snapshot: null },
        begin,
      }),
    ).toEqual({ snapshot: BASE_SNAPSHOT, start: begin })
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
      taken: C(2),
      conflicts: ["a.txt"],
    })
  })
  test("a catch-up's merged commit is what it took", () => {
    expect(now("4-u", "6-m")?.taken).toBe(C(3))
    expect(now("4-u", "5-m")).toMatchObject({ newest: C(3), taken: C(3) })
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
      taken: C(2),
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

describe("planRetention: which snapshots go", () => {
  const B = laneNameForThread("2")
  const rec = (entry: string, lane = LANE): RevisionRecord => ({
    entry: entryId(entry),
    lane,
    commit: null,
    snapshot: snapshotId(entry),
    paths: [],
    conflicts: [],
  })
  const records = [
    rec("01-a"),
    rec("03-a"),
    rec("02-a"),
    rec("04-b", B),
    rec("05-b", B),
    { ...rec("06-d"), snapshot: null },
  ]
  test("an open root keeps every snapshot", () => {
    expect(planRetention({ records, archived: false })).toEqual([])
  })
  test("an archived root keeps each lane's newest", () => {
    expect(planRetention({ records, archived: true })).toEqual([
      "01-a",
      "02-a",
      "04-b",
    ])
  })
  test("the base snapshot is never deleted", () => {
    expect(
      planRetention({
        records: [{ ...rec("00-a"), snapshot: BASE_SNAPSHOT }, rec("01-a")],
        archived: true,
      }),
    ).toEqual([])
  })
})

describe("showHostWorkingCopy: whole path prefixes only", () => {
  test("a root followed by a separator, or by a non-path character, is shown under /mnt/host-working-copy", () => {
    expect(showHostWorkingCopy("read /r/x.ts", "/r")).toBe(
      "read /mnt/host-working-copy/x.ts",
    )
    expect(showHostWorkingCopy('{"path":"/r/a.ts"}', "/r")).toBe(
      '{"path":"/mnt/host-working-copy/a.ts"}',
    )
    expect(showHostWorkingCopy("cd /r && ls", "/r")).toBe(
      "cd /mnt/host-working-copy && ls",
    )
    expect(showHostWorkingCopy("/r", "/r/")).toBe("/mnt/host-working-copy")
  })
  test("never inside a longer name, nor inside a longer path", () => {
    expect(showHostWorkingCopy("/r/workspace/t-ab/x", "/r/workspace/t-a")).toBe(
      "/r/workspace/t-ab/x",
    )
    expect(showHostWorkingCopy("/x/r/y", "/r")).toBe("/x/r/y")
    expect(showHostWorkingCopy("/rr/y", "/r")).toBe("/rr/y")
  })
  test("the file system's root is never a working copy's", () => {
    expect(showHostWorkingCopy("/etc/hosts", "/")).toBe("/etc/hosts")
  })
})

describe("planResolution: the land message", () => {
  const file = (path: string, reasons: number): ConflictFile => ({
    path,
    content: `<<<<<<< ${path}\n=======\n>>>>>>>`,
    ours: {
      label: "ours",
      who: "this thread",
      reasons: Array.from({ length: reasons }, (_, i) => `ours-${i}`),
    },
    theirs: {
      label: "theirs",
      who: "your working copy",
      reasons: Array.from({ length: reasons }, (_, i) => `theirs-${i}`),
    },
  })
  const details = { landing: "l1", lane: LANE, yours: [C1], by: ADA }
  const plan = (files: ConflictFile[], budget: number, intent = "") =>
    planResolution({
      skill: { path: "/s/SKILL.md", content: "SKILL TEXT", hash: "h" },
      files,
      budget,
      details,
      intent,
      incoming: "The project's work",
      timestamp: 1,
    })
  test("the person's text follows the conflict material, whole, under any budget", () => {
    const m = plan([file("a.ts", 50)], 0, "then run the tests")
    expect(m.content.endsWith("then run the tests")).toBe(true)
    expect(m.content.indexOf("<<<<<<< a.ts")).toBeLessThan(
      m.content.indexOf("then run the tests"),
    )
    expect(plan([file("a.ts", 1)], 100_000).content).not.toContain(
      "What the person asked",
    )
  })
  test("the intro names the project's work, not yours", () => {
    expect(plan([file("a.ts", 1)], 100_000).content).toContain(
      "The project's work was merged",
    )
  })
  test("the skill, every file and both labelled sides are always present", () => {
    const m = plan([file("a.ts", 3)], 100_000)
    expect(m.content).toContain("SKILL TEXT")
    expect(m.content).toContain("### ours: this thread")
    expect(m.content).toContain("### theirs: your working copy")
    expect(m.content).toContain("ours-2")
    expect(m.details.files).toEqual(["a.ts"])
    expect(m.details.skill).toEqual({ path: "/s/SKILL.md", hash: "h" })
  })
  test("under budget, older reasons go first; the hunks and the destination's side never do", () => {
    const m = plan([file("a.ts", 50)], 0)
    expect(m.content).toContain("<<<<<<< a.ts")
    expect(m.content).toContain("### ours: this thread")
    expect(m.content).toContain("(50 earlier left out)")
    expect(m.content).not.toContain("ours-0")
    const some = plan([file("a.ts", 50)], 400)
    expect(some.content).toContain("ours-49")
    expect(some.content).not.toContain("ours-0\n")
  })
  test("the column shows one line, never the prompt", () => {
    const m = plan([file("a.ts", 1), file("b.ts", 1)], 100_000)
    expect(m.customType).toBe(LAND_TYPE)
    const shown = renderableMessage(m)
    expect(shown.role).toBe("land")
    expect(shown.content).toBe("⚠ catching up: 2 files conflict")
    expect(renderableMessage(plan([], 100_000)).content).toBe(
      "✓ catching up: no conflicts",
    )
  })
})
