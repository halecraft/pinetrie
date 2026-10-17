import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  citedNames,
  OUTSIDE_NAMES,
  readProse,
  spentOutside,
  splitComments,
  staleNames,
} from "./prose-names.ts"

const ROOT = path.join(import.meta.dirname, "..")
const names = (text: string) => citedNames("d.md", text).map(c => c.name)

describe("citedNames", () => {
  test("a backticked code name is cited, with its line; a plain word or a path is not", () => {
    expect(
      citedNames(
        "d.md",
        "# t\n\n`planWidget()` and `pnpm`, `a/b.ts`\nthen `WIDGET_MAX` and `WidgetView`\n",
      ),
    ).toEqual([
      { file: "d.md", line: 3, name: "planWidget" },
      { file: "d.md", line: 4, name: "WIDGET_MAX" },
      { file: "d.md", line: 4, name: "WidgetView" },
    ])
  })

  test("a table's retired column, and its header, are not cited", () => {
    expect(
      names(
        "| `headName` | in code | retired |\n|---|---|---|\n| **w** | `keptName` | `goneName` |\n\nafter `laterName`\n",
      ),
    ).toEqual(["keptName", "laterName"])
  })

  test("a pipe inside backticks splits no cell", () => {
    expect(
      names(
        "| word | in code | replaces |\n|---|---|---|\n| **w** | `a | b`, `keptName` | `goneName` |\n",
      ),
    ).toEqual(["keptName"])
  })
})

describe("splitComments", () => {
  test("a TypeScript file's comments leave its code, a string's slashes stay, and its lines hold", () => {
    const text =
      '// `fromComment`\nconst url = "http://x" /* `inBlock` */\nlet kept = 1 // `trailingName`\n'
    const { code, comments } = splitComments("a.ts", text)
    expect(code.split("\n")).toHaveLength(text.split("\n").length)
    expect(code).toContain('const url = "http://x"')
    expect(code).toContain("let kept = 1")
    expect(code).not.toMatch(/fromComment|inBlock|trailingName/)
    expect(citedNames("a.ts", comments)).toEqual([
      { file: "a.ts", line: 1, name: "fromComment" },
      { file: "a.ts", line: 2, name: "inBlock" },
      { file: "a.ts", line: 3, name: "trailingName" },
    ])
  })

  test("any other file is code whole", () => {
    expect(splitComments("init", "# `shellName`\n")).toEqual({
      code: "# `shellName`\n",
      comments: "",
    })
  })
})

describe("staleNames and spentOutside", () => {
  const cited = citedNames("d.md", "`inCode` `fromOutside` `goneName`")
  const code = new Set(["inCode"])

  test("a cited name neither the code nor the outside names hold is stale", () => {
    expect(
      staleNames(cited, code, new Set(["fromOutside"])).map(c => c.name),
    ).toEqual(["goneName"])
  })

  test("an outside name no prose cites, or the code holds, is spent", () => {
    expect(
      spentOutside(cited, code, new Set(["fromOutside", "inCode", "x"])),
    ).toEqual(["inCode", "x"])
  })
})

describe("the repository's prose", () => {
  const { code, prose } = readProse(ROOT)

  test("every code name a living doc or a comment cites is in the code, or an outside name", () => {
    expect(staleNames(prose, code, OUTSIDE_NAMES)).toEqual([])
  })

  test("every outside name is cited, and in no code", () => {
    expect(spentOutside(prose, code, OUTSIDE_NAMES)).toEqual([])
  })
})
