import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  ADRS,
  type DocFile,
  FINDINGS,
  NUMBERINGS,
  numberingGaps,
  readDocs,
} from "./numbering.ts"

const doc = (name: string, firstLine: string): DocFile => ({ name, firstLine })

describe("numberingGaps", () => {
  test("files with their own numbers and matching titles have no gaps", () => {
    expect(
      numberingGaps(FINDINGS, [
        doc("S7-branch-convergence.md", "# S7 — divergent branches"),
        doc("S72-offer-start.md", "# S72: where an offer starts"),
      ]),
    ).toEqual({ clashes: [], mismatches: [] })
  })

  test("two files with one number clash, and S7 is not S72", () => {
    expect(
      numberingGaps(FINDINGS, [
        doc("S72-b.md", "# S72 — b"),
        doc("S7-c.md", "# S7 — c"),
        doc("S72-a.md", "# S72 — a"),
      ]).clashes,
    ).toEqual([{ number: 72, files: ["S72-a.md", "S72-b.md"] }])
  })

  test("a file that is not numbered is skipped", () => {
    expect(
      numberingGaps(FINDINGS, [
        doc("README.md", "# Spikes"),
        doc("WS1-walking-skeleton.md", "# WS1"),
        doc("kyneta-issues-verification.md", "# Kyneta"),
      ]),
    ).toEqual({ clashes: [], mismatches: [] })
  })

  test.each([
    ["S59-a.md", "# S5 — a"],
    ["S59-a.md", "# S590 — a"],
    ["S59-a.md", "S59 — a"],
  ])("%s titled %j is a mismatch", (name, firstLine) => {
    expect(numberingGaps(FINDINGS, [doc(name, firstLine)]).mismatches).toEqual([
      { file: name, title: firstLine },
    ])
  })

  test("an ADR's title carries its four digits", () => {
    expect(
      numberingGaps(ADRS, [
        doc("0051-tool-images.md", "# ADR-0051 — a tool's image is a blob"),
        doc("0052-card-undo.md", "# ADR-0051 — card undo"),
        doc("README.md", "# ADRs"),
      ]),
    ).toEqual({
      clashes: [],
      mismatches: [
        { file: "0052-card-undo.md", title: "# ADR-0051 — card undo" },
      ],
    })
  })
})

describe("the repository's numbered docs", () => {
  const root = path.join(import.meta.dirname, "..")
  test.each(
    NUMBERINGS.map(n => [n.dir, n] as const),
  )("%s: no number names two files, and every title carries its number", (_, n) => {
    expect(numberingGaps(n, readDocs(root, n))).toEqual({
      clashes: [],
      mismatches: [],
    })
  })
})
