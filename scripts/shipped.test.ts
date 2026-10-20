// What the package ships, read as the build reads it (`gatherPackage`): no
// file names a `.ts` path in a string, which an installed package does not
// have, and the observer's image holds every module its server loads.

import path from "node:path"
import { parseSync } from "oxc-parser"
import { describe, expect, test } from "vitest"
import { OBSERVER_SOURCE_DIRS } from "../packages/lanehost/index.ts"
import { reachable } from "./imports.ts"
import { gatherPackage, importGraph, shippedSources } from "./package.ts"
import { type Node, walk } from "./sources.ts"

const IMPORTING = [
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
]

/** A `.ts` file's name or path: no spaces, and a name before `.ts`, so not a suffix (`.test.ts`). */
const TS_PATH = /^\S*(^|\/)[^./\s][^/\s]*\.ts$/

/** Each string in `text` that names a `.ts` file. */
function tsPathStrings(file: string, text: string): readonly string[] {
  const found: string[] = []
  const program = parseSync(file, text).program as unknown as Node
  walk(program, (n, ancestors) => {
    const parent = ancestors.at(-1)
    // An import's specifier is the build's to rewrite.
    if (parent !== undefined && IMPORTING.includes(parent.type)) return
    const values =
      n.type === "Literal" && typeof n.value === "string"
        ? [n.value]
        : n.type === "TemplateElement"
          ? [String((n.value as { cooked?: unknown } | null)?.cooked ?? "")]
          : []
    for (const v of values) if (TS_PATH.test(v)) found.push(v)
  })
  return found
}

test("tsPathStrings: a path ending in .ts, in a string or a template, not a sentence about one", () => {
  expect(
    tsPathStrings(
      "a.ts",
      [
        'const a = "packages/x/y.ts"',
        `const b = \`${"$"}{root}/hop.ts\``,
        'const c = "Filter by glob, e.g. *.ts"',
        'const d = "y.js"',
        'const s = ".test.ts"',
        'import { e } from "./e.ts"',
      ].join("\n"),
    ),
  ).toEqual(["packages/x/y.ts", "/hop.ts"])
})

describe("the package's shipped files", () => {
  const root = path.join(import.meta.dirname, "..")
  const g = gatherPackage(root)
  const graph = importGraph(g)
  const shipped = shippedSources(g)

  test("no shipped file names a .ts path in a string, outside @pinetrie/install", () => {
    const named = shipped
      .filter(f => !f.startsWith("packages/install/"))
      .flatMap(f =>
        tsPathStrings(f, g.sources.get(f) ?? "").map(v => `${f}: ${v}`),
      )
    expect(named).toEqual([])
  })

  test("the observer's image holds every module its server loads", () => {
    const outside = [
      ...reachable(graph, ["packages/lanehost/observer-server.ts"]),
    ].filter(f => !OBSERVER_SOURCE_DIRS.includes(path.dirname(f) as never))
    expect(outside).toEqual([])
  })
})
