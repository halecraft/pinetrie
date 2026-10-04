import {
  commitId,
  entryId,
  type LandingRecord,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  LANDING,
  landingRecord,
  planResolution,
  renderableMessage,
  setRecord,
} from "./index.ts"
import { type ConflictFile, LAND_TYPE, landingOutcome } from "./land.ts"

const LANE = laneNameForThread("1")
const ADA = writerId("ada")
const C1 = commitId("c1")

describe("landing", () => {
  test("LANDING round-trips, keyed by the resolution's own id", () => {
    const landing: LandingRecord = {
      id: "l1",
      lane: LANE,
      prompt: entryId("e2"),
      state: "resolved",
      by: ADA,
      at: 2,
    }
    const g = setRecord(LANDING, landing)
    expect([g.key, LANDING.decode(g.value, g.key)]).toEqual(["l1", landing])
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
