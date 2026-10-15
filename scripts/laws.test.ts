import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { LAWS_DOC, LAWS_SUITE, lawGaps, lawsInDoc } from "./laws.ts"

const doc = (...bullets: readonly string[]) =>
  `# x\n\n## The history algebra (x)\n\n${bullets.join("\n")}\n\n## Next\n\n- **L9, outside the section.**\n`
const suite = (...titles: readonly string[]) =>
  titles
    .map(t => `  withRig(\n    "${t}",\n    async rig => {},\n  )\n`)
    .join("")

describe("lawGaps: the laws and their tests agree", () => {
  test("each law with one test, and no other law title, agrees", () => {
    expect(
      lawGaps(
        doc("- **L1, one.** a", "- **L2, two.** b"),
        suite("L1: one", "L2: two", "an example"),
      ),
    ).toEqual([])
  })

  test("a law with no test, a law with two, and a title naming no law are each a gap", () => {
    expect(
      lawGaps(
        doc("- **L1, one.** a", "- **L2, two.** b"),
        suite("L2: two", "L2: two again", "L3: three"),
      ),
    ).toEqual([
      { kind: "untested", law: "L1" },
      { kind: "tested-twice", law: "L2" },
      { kind: "no-law", title: "L3: three" },
    ])
  })

  test("a law the doc marks as the folder graph's needs no test yet", () => {
    expect(
      lawGaps(
        doc("- **L4, bases (the folder graph's, not checked against jj).** c"),
        suite(),
      ),
    ).toEqual([])
  })

  test("a law outside the algebra's section is none", () => {
    expect(lawGaps(doc(), suite("L9: outside"))).toEqual([
      { kind: "no-law", title: "L9: outside" },
    ])
  })
})

test("the repository's laws each have one port-suite test", () => {
  const root = path.join(import.meta.dirname, "..")
  const read = (p: string) => readFileSync(path.join(root, p), "utf8")
  expect(lawsInDoc(read(LAWS_DOC)).length).toBeGreaterThan(0)
  expect(lawGaps(read(LAWS_DOC), read(LAWS_SUITE))).toEqual([])
})
