import { pointId, threadIdFor, writerId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planResolution, renderableMessage } from "./index.ts"
import {
  type ConflictFile,
  conflictSections,
  type Floor,
  LAND_TYPE,
  type PromptBudget,
  resolutionFloor,
} from "./land.ts"

const LANE = threadIdFor("1")
const ADA = writerId("ada")
const C1 = pointId("c1")

/** pi's estimate of a custom message (`packages/pi/compaction.ts`): a token per four characters. */
const allowanceOf = (tokens: number): PromptBudget => ({
  tokens,
  estimate: content => Math.ceil(content.length / 4),
})

const floorOf = (
  tokens: number,
  intent = "",
  latest = "Accepted work",
): Floor => {
  const found = resolutionFloor({
    budget: allowanceOf(tokens),
    skill: { path: "/s/SKILL.md", content: "SKILL TEXT", hash: "h" },
    intent,
    latest,
  })
  if (found.kind !== "fits") throw new Error("the floor does not fit")
  return found.floor
}

describe("conflictSections: each conflict's lines, by jj's markers", () => {
  test("two conflicts give two sections, with their lines", () => {
    const content = [
      "a",
      "<<<<<<< conflict 1 of 2",
      "x",
      ">>>>>>> conflict 1 of 2 ends",
      "b",
      "<<<<<<< conflict 2 of 2",
      "y",
      ">>>>>>> conflict 2 of 2 ends",
    ].join("\n")
    expect(conflictSections(content)).toEqual([
      {
        from: 2,
        to: 4,
        text: "<<<<<<< conflict 1 of 2\nx\n>>>>>>> conflict 1 of 2 ends",
      },
      {
        from: 6,
        to: 8,
        text: "<<<<<<< conflict 2 of 2\ny\n>>>>>>> conflict 2 of 2 ends",
      },
    ])
  })
  test("longer markers close only at a closing marker as long", () => {
    const content = [
      "<<<<<<<<<<< conflict 1 of 1",
      ">>>>>>> a line of the file",
      "z",
      ">>>>>>>>>>> conflict 1 of 1 ends",
      "after",
    ].join("\n")
    expect(conflictSections(content).map(s => [s.from, s.to])).toEqual([[1, 4]])
  })
  test("an unclosed conflict runs to the end; no markers, no sections", () => {
    expect(
      conflictSections("a\n<<<<<<< c\nb\nc").map(s => [s.from, s.to]),
    ).toEqual([[2, 4]])
    expect(conflictSections("a\n<<<<<<b\n=======")).toEqual([])
  })
})

describe("planResolution: the land message", () => {
  const file = (
    path: string,
    reasons: number,
    content = `<<<<<<< ${path}\n=======\n>>>>>>>`,
  ): ConflictFile => ({
    path,
    content,
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
  /** A file of `size` characters around one small conflict. */
  const large = (path: string, size: number, reasons = 1) =>
    file(
      path,
      reasons,
      `${"a".repeat(size / 2)}\n<<<<<<< conflict 1 of 1\nCONFLICT\n>>>>>>> conflict 1 of 1 ends\n${"b".repeat(size / 2)}`,
    )
  const details = { lane: LANE, merged: [C1], by: ADA }
  const plan = (files: ConflictFile[], tokens: number, intent = "") =>
    planResolution({
      floor: floorOf(tokens, intent),
      files,
      details,
      timestamp: 1,
    })
  test("the person's text follows the conflict material, whole, in every way of showing the files", () => {
    for (const tokens of [100_000, 2_000, 300, 100]) {
      const m = plan([large("a.ts", 6_000, 50)], tokens, "then run the tests")
      expect(m.content.endsWith("then run the tests")).toBe(true)
    }
    const m = plan([file("a.ts", 50)], 100_000, "then run the tests")
    expect(m.content.indexOf("<<<<<<< a.ts")).toBeLessThan(
      m.content.indexOf("then run the tests"),
    )
    expect(plan([file("a.ts", 1)], 100_000).content).not.toContain(
      "What the person asked",
    )
  })
  test("the intro names accepted work, not yours", () => {
    expect(plan([file("a.ts", 1)], 100_000).content).toContain(
      "Accepted work was merged",
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
  test("under budget, older reasons go first; the hunks and the destination's side stay", () => {
    const m = plan([file("a.ts", 50)], 300)
    expect(m.content).toContain("<<<<<<< a.ts")
    expect(m.content).toContain("### ours: this thread")
    expect(m.content).toContain("ours-49")
    expect(m.content).not.toContain("ours-0\n")
    expect(m.content).toMatch(/- \(\d+ earlier left out\)/)
  })
  test("the files show whole, by their conflict sections, by name, or as a count, whichever fits", () => {
    const files = [large("a.ts", 8_000), large("b.ts", 8_000)]
    const whole = plan(files, 10_000).content
    expect(whole).toContain("aaaa")
    const sections = plan(files, 1_000).content
    expect(sections).toContain("Lines 2–4:")
    expect(sections).toContain("CONFLICT")
    expect(sections).not.toContain("aaaa")
    const names = plan(files, 150).content
    expect(names).toContain("## b.ts")
    expect(names).not.toContain("CONFLICT")
    expect(names).not.toContain("```")
    const count = plan(files, 90).content
    expect(count).not.toContain("a.ts")
    expect(count).toContain("files conflict")
    for (const shown of [whole, sections, names]) {
      expect(shown).toContain("### ours: this thread")
      expect(shown).toContain("### theirs: your working copy")
    }
    for (const tokens of [10_000, 1_000, 150, 90])
      expect(plan(files, tokens).details.files).toEqual(["a.ts", "b.ts"])
  })
  test("one way for every file: a small file is not shown whole beside a large one shown less", () => {
    const m = plan([file("small.ts", 1), large("huge.ts", 20_000)], 1_000)
    expect(m.content).toContain("## small.ts\n\nConflict sections only")
  })
  test("the code gives way before the reasons: every side keeps its newest", () => {
    const reasons = (side: string) =>
      Array.from({ length: 3 }, (_, i) => `${side}-${"r".repeat(400)}-${i}`)
    const f: ConflictFile = {
      ...large("a.ts", 4_000),
      ours: { label: "ours", who: "this thread", reasons: reasons("ours") },
      theirs: { label: "theirs", who: "yours", reasons: reasons("theirs") },
    }
    // Whole fits with no reasons (about 1 100 tokens), not with its newest.
    const m = plan([f], 1_250).content
    expect(m).not.toContain("aaaa")
    expect(m).toContain("-2\n")
    expect(m).toContain(`theirs-${"r".repeat(400)}-2`)
  })
  test("every prompt says jj lists what is left", () => {
    const files = [large("a.ts", 8_000), large("b.ts", 8_000)]
    for (const tokens of [10_000, 1_000, 150, 90])
      expect(plan(files, tokens).content).toContain("`jj resolve --list`")
  })
  test("whatever the files and reasons, the message fits its budget", () => {
    for (const tokens of [90, 150, 400, 1_000, 3_000, 30_000])
      for (const reasons of [0, 1, 40])
        for (const files of [
          [file("a.ts", reasons)],
          [large("a.ts", 6_000, reasons), large("b.ts", 60_000, reasons)],
          Array.from({ length: 30 }, (_, i) =>
            large(`f${i}.ts`, 2_000, reasons),
          ),
        ]) {
          const m = plan(files, tokens)
          expect(Math.ceil(m.content.length / 4)).toBeLessThanOrEqual(tokens)
        }
  })
  test("a conflict of 38 large files shows each by name, within 20 000 tokens", () => {
    const files = Array.from({ length: 38 }, (_, i) =>
      file(
        `f${i}.ts`,
        2,
        `${"a".repeat(12_100)}\n<<<<<<< c\n${"x".repeat(2_800)}\n>>>>>>> c ends\n${"b".repeat(12_100)}`,
      ),
    )
    const m = plan(files, 20_000)
    expect(Math.ceil(m.content.length / 4)).toBeLessThanOrEqual(20_000)
    expect(m.content).toContain("## f37.ts")
    expect(m.content).toContain("each file below is named only")
  })
  test("the floor: too large only when the skill and the person's text overflow", () => {
    expect(
      resolutionFloor({
        budget: allowanceOf(100),
        skill: null,
        intent: "x".repeat(1_000),
        latest: "Accepted work",
      }),
    ).toMatchObject({ kind: "too-large", budget: 100 })
    const floor = floorOf(90)
    for (const n of [1, 50]) {
      const files = Array.from({ length: n }, (_, i) =>
        large(`f${i}.ts`, 2_000),
      )
      expect(
        planResolution({ floor, files, details, timestamp: 1 }).content,
      ).toBe(floor.content)
    }
  })
  test("the column shows one line, never the prompt", () => {
    const m = plan([file("a.ts", 1), file("b.ts", 1)], 100_000)
    expect(m.customType).toBe(LAND_TYPE)
    const shown = renderableMessage(m)
    expect(shown.role).toBe("land")
    expect(shown.content).toBe("⚠ got the latest: 2 files conflict")
    expect(renderableMessage(plan([], 100_000)).content).toBe(
      "✓ got the latest: no conflicts",
    )
  })
})
