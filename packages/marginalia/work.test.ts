import {
  commitId,
  ERR,
  entryId,
  type LandingRecord,
  laneNameForThread,
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
  LAND_TYPE,
  landingOutcome,
  planLand,
  planResolution,
  planTake,
  planTurnRecord,
  renderableMessage,
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
  const revision = { entry: entryId("e1"), lane: LANE, commit: C1 }
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
    kind: "workspaces" as const,
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
  test("a direct lane's prompt records no commit, and that decodes", () => {
    expect(
      decodeRevisionRecord({ ...revision, commit: null })?.commit,
    ).toBeNull()
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

describe("planTurnRecord: every prompt, and messages that changed files", () => {
  const base = { entry: entryId("e"), lane: LANE, newest: C1 }
  test("a prompt always gets a record: a commit of edits, else the newest revision", () => {
    expect(
      planTurnRecord({ ...base, isPrompt: true, own: true, committed: C2 })
        ?.commit,
    ).toBe(C2)
    expect(
      planTurnRecord({ ...base, isPrompt: true, own: true, committed: null })
        ?.commit,
    ).toBe(C1)
  })
  test("an assistant message gets one only when its calls changed files", () => {
    expect(
      planTurnRecord({ ...base, isPrompt: false, own: true, committed: C2 })
        ?.commit,
    ).toBe(C2)
    expect(
      planTurnRecord({ ...base, isPrompt: false, own: true, committed: null }),
    ).toBeNull()
  })
  test("a lane working directly records its prompts with no commit, and nothing else", () => {
    expect(
      planTurnRecord({ ...base, isPrompt: true, own: false, committed: null }),
    ).toEqual({
      entry: base.entry,
      lane: LANE,
      commit: null,
    })
    expect(
      planTurnRecord({ ...base, isPrompt: false, own: false, committed: null }),
    ).toBeNull()
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
