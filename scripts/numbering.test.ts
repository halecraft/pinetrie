import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  ADRS,
  FINDINGS,
  NUMBERINGS,
  numberingGaps,
  type RecordFile,
  readRecord,
} from "./numbering.ts"

/** A file in `n`'s folder, `name` under it, whose text starts `firstLine`. */
const doc = (
  n: { readonly dir: string },
  name: string,
  firstLine: string,
): RecordFile => ({ path: `${n.dir}/${name}`, text: `${firstLine}\n\nbody\n` })
const spike = (name: string, firstLine: string) =>
  doc(FINDINGS, name, firstLine)
const adr = (name: string, firstLine: string) => doc(ADRS, name, firstLine)

describe("numberingGaps", () => {
  test("files with their own numbers and matching titles have no gaps", () => {
    expect(
      numberingGaps(FINDINGS, [
        spike("S7-branch-convergence.md", "# S7 — divergent branches"),
        spike("S72-offer-start.md", "# S72: where an offer starts"),
      ]),
    ).toEqual({ clashes: [], mismatches: [] })
  })

  test("two files with one number clash, and S7 is not S72", () => {
    expect(
      numberingGaps(FINDINGS, [
        spike("S72-b.md", "# S72 — b"),
        spike("S7-c.md", "# S7 — c"),
        spike("S72-a.md", "# S72 — a"),
      ]).clashes,
    ).toEqual([{ number: 72, files: ["S72-a.md", "S72-b.md"] }])
  })

  test("a file that is not numbered is skipped", () => {
    expect(
      numberingGaps(FINDINGS, [
        spike("README.md", "# Spikes"),
        spike("WS1-walking-skeleton.md", "# WS1"),
        spike("kyneta-issues-verification.md", "# Kyneta"),
        adr("0007-transport.md", "# ADR-0007 — another folder's"),
      ]),
    ).toEqual({ clashes: [], mismatches: [] })
  })

  test.each([
    ["S59-a.md", "# S5 — a"],
    ["S59-a.md", "# S590 — a"],
    ["S59-a.md", "S59 — a"],
  ])("%s titled %j is a mismatch", (name, firstLine) => {
    expect(
      numberingGaps(FINDINGS, [spike(name, firstLine)]).mismatches,
    ).toEqual([{ file: name, title: firstLine }])
  })

  test("an ADR's title carries its four digits", () => {
    expect(
      numberingGaps(ADRS, [
        adr("0051-tool-images.md", "# ADR-0051 — a tool's image is a blob"),
        adr("0052-card-undo.md", "# ADR-0051 — card undo"),
        adr("README.md", "# ADRs"),
      ]),
    ).toEqual({
      clashes: [],
      mismatches: [
        { file: "0052-card-undo.md", title: "# ADR-0051 — card undo" },
      ],
    })
  })

  test("a number in the archive clashes with the same number outside it", () => {
    expect(
      numberingGaps(ADRS, [
        adr("archive/9011-a.md", "# ADR-9011 — a"),
        adr("9011-b.md", "# ADR-9011 — b"),
      ]).clashes,
    ).toEqual([{ number: 9011, files: ["9011-b.md", "archive/9011-a.md"] }])
  })
})

describe("the repository's numbered docs", () => {
  const files = readRecord(path.join(import.meta.dirname, ".."))
  test.each(NUMBERINGS.map(n => [n.dir, n] as const))(
    "%s: no number names two files, and every title carries its number",
    (_, n) => {
      expect(numberingGaps(n, files)).toEqual({
        clashes: [],
        mismatches: [],
      })
    },
  )
})
