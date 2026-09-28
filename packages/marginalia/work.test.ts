import {
  BASE_SNAPSHOT,
  commitId,
  ERR,
  entryId,
  type LandingRecord,
  laneNameForThread,
  type RevisionRecord,
  snapshotId,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type ConflictFile,
  decodeAll,
  decodeLandingRecord,
  decodeLaneRecord,
  decodeProjectRecord,
  decodeRevisionRecord,
  encodeWorkRecord,
  entryText,
  forkPoint,
  LAND_TYPE,
  landingOutcome,
  planLand,
  planResolution,
  planRetention,
  planTake,
  planTurnRecord,
  renderableMessage,
  showYours,
} from "./index.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada")
const C1 = commitId("c1")
const C2 = commitId("c2")
const view = {
  name: LANE,
  tip: null,
  running: false,
  waiting: 0,
  askedBy: null,
}

describe("records: one encoder, total decoders", () => {
  const lane = {
    lane: LANE,
    work: { kind: "own" as const },
    by: ADA,
    createdAt: 1,
  }
  const revision = {
    entry: entryId("e1"),
    lane: LANE,
    commit: C1,
    snapshot: snapshotId("e1"),
  }
  const landing: LandingRecord = {
    id: "l1",
    lane: LANE,
    prompt: entryId("e2"),
    yours: [C1],
    result: C2,
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
    const l = encodeWorkRecord({ kind: "lane", record: lane })
    expect([l.namespace, l.key, decodeLaneRecord(l.value)]).toEqual([
      "pineta.lane",
      LANE,
      lane,
    ])
    const r = encodeWorkRecord({ kind: "revision", record: revision })
    expect([r.key, decodeRevisionRecord(r.value)]).toEqual(["e1", revision])
    const g = encodeWorkRecord({ kind: "landing", record: landing })
    expect([g.key, decodeLandingRecord(g.value)]).toEqual(["l1", landing])
    const p = encodeWorkRecord({ kind: "project", record: project })
    expect(decodeProjectRecord(p.value)).toEqual(project)
  })
  test("a direct lane's prompt records no commit and no disk, and that decodes", () => {
    expect(
      decodeRevisionRecord({ ...revision, commit: null, snapshot: null }),
    ).toEqual({ ...revision, commit: null, snapshot: null })
  })
  test("a record from before lane containers has no snapshot key: it decodes as none", () => {
    const { snapshot: _, ...old } = revision
    expect(decodeRevisionRecord(old)).toEqual({ ...old, snapshot: null })
  })
  test("a project record from before lane containers is dropped, and rewritten at start", () => {
    expect(
      decodeProjectRecord({
        kind: "workspaces",
        root: "/p",
        rootDefault: "own",
      }),
    ).toBeUndefined()
  })
  test("malformed values are dropped, never thrown", () => {
    expect(
      decodeAll(
        [
          { value: { ...lane, work: { kind: "direct" } } },
          { value: 3 },
          { value: lane },
        ],
        decodeLaneRecord,
      ),
    ).toEqual([lane])
  })
})

describe("landing", () => {
  const own = {
    lane: LANE,
    work: { kind: "own" as const },
    by: ADA,
    createdAt: 1,
  }
  test("planLand: an idle own lane starts, a busy one holds, a direct one is refused", () => {
    expect(planLand({ record: own, view })).toEqual({ kind: "start" })
    expect(planLand({ record: own, view: { ...view, running: true } })).toEqual(
      {
        kind: "hold",
        position: 0,
      },
    )
    expect(
      planLand({
        record: { ...own, work: { kind: "direct", dir: "/x" } },
        view,
      }),
    ).toEqual({ kind: "refused", code: ERR.NOT_OWN_COPY })
    expect(planLand({ record: undefined, view })).toMatchObject({
      kind: "refused",
    })
  })
  const landing: LandingRecord = {
    id: "l1",
    lane: LANE,
    prompt: entryId("e2"),
    yours: [C1],
    result: C2,
    state: "resolved",
    by: ADA,
    at: 2,
  }
  test("planTake: a resolved landing, while your @- is the one it merged", () => {
    expect(planTake({ landing, yoursNow: [C1] })).toEqual({
      kind: "take",
      result: C2,
    })
    expect(planTake({ landing, yoursNow: [commitId("c9")] })).toEqual({
      kind: "refused",
      code: ERR.MOVED,
    })
    expect(
      planTake({ landing: { ...landing, state: "needs_you" }, yoursNow: [C1] }),
    ).toMatchObject({
      kind: "refused",
    })
  })
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
  }
  test("a prompt always gets a record: its disk, and a commit of edits, else the newest revision", () => {
    expect(planTurnRecord({ ...base, isPrompt: true, committed: C2 })).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: C2,
      snapshot: S,
    })
    expect(
      planTurnRecord({ ...base, isPrompt: true, committed: null }),
    ).toEqual({ entry: base.entry, lane: LANE, commit: C1, snapshot: S })
  })
  test("a turn with tool calls gets its disk, and a commit only when one was made", () => {
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: C2,
      }),
    ).toEqual({ entry: base.entry, lane: LANE, commit: C2, snapshot: S })
    expect(
      planTurnRecord({
        ...base,
        isPrompt: false,
        toolCalls: true,
        committed: null,
      }),
    ).toEqual({ entry: base.entry, lane: LANE, commit: null, snapshot: S })
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
    })
    expect(
      planTurnRecord({ ...direct, isPrompt: false, toolCalls: true }),
    ).toBeNull()
  })
})

describe("forkPoint: a snapshot to clone, and the commits to start on", () => {
  const S = snapshotId("e")
  const yours = [commitId("y1"), commitId("y2")]
  test("from a turn: its snapshot and the commit above", () => {
    expect(
      forkPoint({ above: { lane: LANE, commit: C2, snapshot: S }, yours }),
    ).toEqual({ snapshot: S, commits: [C2] })
  })
  test("from a lane before lane containers: the base snapshot at its commit", () => {
    expect(
      forkPoint({ above: { lane: LANE, commit: C2, snapshot: null }, yours }),
    ).toEqual({ snapshot: BASE_SNAPSHOT, commits: [C2] })
  })
  test("from nothing: the base snapshot at your @-, every parent of it", () => {
    expect(
      forkPoint({ above: { lane: null, commit: null, snapshot: null }, yours }),
    ).toEqual({ snapshot: BASE_SNAPSHOT, commits: yours })
  })
})

describe("planRetention: which snapshots go", () => {
  const B = laneNameForThread("2")
  const rec = (entry: string, lane = LANE): RevisionRecord => ({
    entry: entryId(entry),
    lane,
    commit: null,
    snapshot: snapshotId(entry),
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

describe("showYours: whole path prefixes only", () => {
  test("a root followed by a separator, or by a non-path character, is shown under /yours", () => {
    expect(showYours("read /r/x.ts", "/r")).toBe("read /yours/x.ts")
    expect(showYours('{"path":"/r/a.ts"}', "/r")).toBe('{"path":"/yours/a.ts"}')
    expect(showYours("cd /r && ls", "/r")).toBe("cd /yours && ls")
    expect(showYours("/r", "/r/")).toBe("/yours")
  })
  test("never inside a longer name, nor inside a longer path", () => {
    expect(showYours("/r/workspace/t-ab/x", "/r/workspace/t-a")).toBe(
      "/r/workspace/t-ab/x",
    )
    expect(showYours("/x/r/y", "/r")).toBe("/x/r/y")
    expect(showYours("/rr/y", "/r")).toBe("/rr/y")
  })
  test("the file system's root is never a working copy's", () => {
    expect(showYours("/etc/hosts", "/")).toBe("/etc/hosts")
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
  const plan = (files: ConflictFile[], budget: number) =>
    planResolution({
      skill: { path: "/s/SKILL.md", content: "SKILL TEXT", hash: "h" },
      files,
      budget,
      details,
      timestamp: 1,
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
  test("the column shows one line; citing it cites that line, never the prompt", () => {
    const m = plan([file("a.ts", 1), file("b.ts", 1)], 100_000)
    expect(m.customType).toBe(LAND_TYPE)
    const shown = renderableMessage(m)
    expect(shown.role).toBe("land")
    expect(shown.content).toBe("⚠ landing your work: 2 files conflict")
    expect(entryText(m)).toBe("⚠ landing your work: 2 files conflict")
    expect(renderableMessage(plan([], 100_000)).content).toBe(
      "✓ landing your work: no conflicts",
    )
  })
})
