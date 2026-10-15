import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { LAW_SETS, lawGaps, lawsInDoc } from "./laws.ts"

const SECTION = "The laws"
const doc = (...bullets: readonly string[]) =>
  `# x\n\n## ${SECTION} (x)\n\n${bullets.join("\n")}\n\n## Next\n\n- **Outside the section.**\n`
const suite = (...titles: readonly string[]) =>
  titles
    .map(t => `  withRig(\n    "${t}",\n    async rig => {},\n  )\n`)
    .join("")

describe("lawGaps: the laws and their tests agree", () => {
  test("each law with one test, and no other law title, agrees", () => {
    expect(
      lawGaps(
        doc("- **One holds.** a", "- **A turn's two hold.** b"),
        SECTION,
        suite("One holds.", "A turn's two hold.", "an example"),
      ),
    ).toEqual([])
  })

  test("a law with no test, a law with two, and a law's title naming no law are each a gap", () => {
    expect(
      lawGaps(
        doc("- **One holds.** a", "- **Two holds.** b"),
        SECTION,
        suite("Two holds.", "Two holds.", "Three holds."),
      ),
    ).toEqual([
      { kind: "untested", law: "One holds." },
      { kind: "tested-twice", law: "Two holds." },
      { kind: "no-law", title: "Three holds." },
    ])
  })

  test("a law outside its section is none", () => {
    expect(lawsInDoc(doc(), SECTION)).toEqual([])
    expect(lawGaps(doc(), SECTION, suite("Outside the section."))).toEqual([
      { kind: "no-law", title: "Outside the section." },
    ])
  })

  test("two sets are checked apart: one set's laws are no other suite's", () => {
    const a = doc("- **One holds.** a")
    const b = `# y\n\n## Other laws\n\n- **Two holds.** b\n`
    expect(lawGaps(a, SECTION, suite("One holds."))).toEqual([])
    expect(lawGaps(b, "Other laws", suite("One holds."))).toEqual([
      { kind: "untested", law: "Two holds." },
      { kind: "no-law", title: "One holds." },
    ])
  })
})

describe.each(LAW_SETS)("$doc, $section", set => {
  test("each law has one test in its suite, and each law's title is a law", () => {
    const root = path.join(import.meta.dirname, "..")
    const read = (p: string) => readFileSync(path.join(root, p), "utf8")
    const doc = read(set.doc)
    expect(lawsInDoc(doc, set.section).length).toBeGreaterThan(0)
    expect(lawGaps(doc, set.section, read(set.suite))).toEqual([])
  })
})

test("every package doc's section of laws is a checked set", () => {
  const root = path.join(import.meta.dirname, "..")
  const sections = readdirSync(path.join(root, "packages")).flatMap(dir => {
    const doc = `packages/${dir}/TECHNICAL.md`
    let text: string
    try {
      text = readFileSync(path.join(root, doc), "utf8")
    } catch {
      return []
    }
    return [...text.matchAll(/^## (.*\blaws\b.*)$/gm)].map(m => ({
      doc,
      section: m[1] ?? "",
    }))
  })
  expect(sections.length).toBeGreaterThan(0)
  for (const s of sections)
    expect(
      LAW_SETS.some(
        set => set.doc === s.doc && s.section.startsWith(set.section),
      ),
    ).toBe(true)
})
