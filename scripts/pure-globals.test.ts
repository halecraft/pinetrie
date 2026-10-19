import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { reachable } from "./imports.ts"
import { gatherPackage, importGraph } from "./package.ts"
import { declaredGlobals, globalProblems } from "./pure-globals.ts"

const ROOT = path.join(import.meta.dirname, "..")

describe("declaredGlobals", () => {
  test("each global once, with the doc comment on its first declaration", () => {
    expect(
      declaredGlobals(
        [
          "// header",
          "",
          "/** `packages/a.ts`: why. */",
          "interface Signal {",
          "  readonly aborted: boolean",
          "}",
          "declare var Signal: { abort(): Signal }",
          "declare class Plain {}",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "Signal", doc: "/** `packages/a.ts`: why. */\n" },
      { name: "Plain", doc: null },
    ])
  })
})

describe("globalProblems", () => {
  const files = new Map([
    ["packages/a.ts", "export const n = new TextEncoder()"],
    ["packages/b.ts", "// TextEncoder, in prose only\nexport const m = 1"],
  ])
  const reached = new Set(["packages/a.ts", "packages/b.ts"])

  test("a global its named file uses is no problem", () => {
    expect(
      globalProblems(
        [{ name: "TextEncoder", doc: "/** `packages/a.ts`: bytes. */" }],
        files,
        reached,
      ),
    ).toEqual([])
  })

  test("a global no line accounts for, a file that names it only in prose, and a file the config does not reach are each a problem", () => {
    expect(
      globalProblems(
        [
          { name: "TextDecoder", doc: null },
          { name: "TextEncoder", doc: "/** `packages/b.ts`: bytes. */" },
          { name: "URL", doc: "/** `packages/c.ts`: paths. */" },
        ],
        files,
        reached,
      ),
    ).toEqual([
      "TextDecoder: no line before it names a file that needs it",
      "TextEncoder: packages/b.ts does not name it",
      "URL: packages/c.ts is no file the pure config reaches",
    ])
  })
})

/** The sources `tsconfig.pure.json` starts from: its `include`, tests, fixtures and the declarations left out. */
function pureEntries(sources: readonly string[]): readonly string[] {
  const config = JSON.parse(
    readFileSync(path.join(ROOT, "tsconfig.pure.json"), "utf8").replace(
      /^\s*\/\/.*$/gm,
      "",
    ),
  ) as { include: readonly string[] }
  return sources.filter(
    file =>
      !/\.test\.tsx?$|(^|\/)fixtures\.ts$/.test(file) &&
      config.include.some(
        root =>
          !root.endsWith(".d.ts") &&
          (file === root || file.startsWith(`${root}/`)),
      ),
  )
}

test("every global pure code may name is needed by a file the pure config reaches, which the line before it names", () => {
  const g = gatherPackage(ROOT)
  const reached = reachable(importGraph(g), pureEntries([...g.sources.keys()]))
  const declared = declaredGlobals(
    readFileSync(path.join(ROOT, "pure-globals.d.ts"), "utf8"),
  )
  expect(declared.map(d => d.name)).not.toEqual([])
  expect(globalProblems(declared, g.sources, reached)).toEqual([])
})
