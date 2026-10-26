// Where a retired word may not come back (`docs/glossary.md`): inside the
// code's names, and in what people and the agent read. ADRs and findings keep
// the words they were written with, and are outside its reach.

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { readSources } from "./sources.ts"
import {
  identifierNames,
  phrasesNothingSays,
  RETIRED_IN_NAMES,
  readTexts,
  retiredLines,
  retiredNames,
} from "./words.ts"

const ROOT = path.join(import.meta.dirname, "..")
const GLOSSARY = readFileSync(path.join(ROOT, "docs/glossary.md"), "utf8")

describe("the rules", () => {
  test("an identifier holds a retired name in any case; a string or a comment does not count", () => {
    const source = {
      file: "a.ts",
      text: [
        "// yours, in a comment",
        'const label = "queue after yours"',
        "const NOT_YOURS = 1",
        "const o = { afterYours: label }",
        "function f(yoursDir: string) { return yoursDir }",
      ].join("\n"),
    }
    expect(retiredNames(source, ["yours"])).toEqual([
      "a.ts: NOT_YOURS",
      "a.ts: afterYours",
      "a.ts: yoursDir",
    ])
  })

  test("a file of a migration's old shapes may hold a retired name", () => {
    expect(
      retiredNames(
        { file: "old.ts", text: "const yours = 1" },
        ["yours"],
        ["old.ts"],
      ),
    ).toEqual([])
  })

  test("a kept setting key passes whole, and a name that only holds it does not", () => {
    const source = {
      file: "a.ts",
      text: "const o = { catchUp: true, catchUpNow: 1 }",
    }
    expect(retiredNames(source, ["catchup"])).toEqual(["a.ts: catchUpNow"])
  })

  test("identifierNames reads bindings, references, property keys and JSX", () => {
    expect(
      identifierNames(
        "a.tsx",
        "const x = { k: y.z }\nconst e = <Mark color={c} />",
      ),
    ).toEqual(["x", "k", "y", "z", "e", "Mark", "color", "c"])
  })

  test("the phrases nothing says are the glossary list's quoted bullets, up to the next heading", () => {
    const glossary = [
      "| **accepted work** | … | `accepted` | the line, your folder |",
      "## Phrases nothing says",
      "",
      '- "your folder": accepted work, for every kind of project.',
      '- "the root": a code word.',
      "## Where these are configured",
      '- "not this": another list',
    ].join("\n")
    expect(phrasesNothingSays(glossary)).toEqual(["your folder", "the root"])
  })

  test("a line that says a retired phrase, in any case, is named with its place", () => {
    expect(
      retiredLines({ file: "p.md", text: "fine\nYour Folder holds it" }, [
        "your folder",
      ]),
    ).toEqual(["p.md:2: Your Folder holds it"])
  })
})

describe("the repository", () => {
  test("no identifier holds a retired name, but in a migration's old shapes", () => {
    expect(
      readSources(ROOT, { tests: true }).flatMap(s =>
        retiredNames(s, RETIRED_IN_NAMES),
      ),
    ).toEqual([])
  })

  test("nothing people or the agent read says a phrase the glossary retires", () => {
    const phrases = phrasesNothingSays(GLOSSARY)
    expect(phrases).toContain("your folder")
    expect(readTexts(ROOT).flatMap(s => retiredLines(s, phrases))).toEqual([])
  })
})
