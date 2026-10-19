import { describe, expect, test } from "vitest"
import { loadedImports, reachable } from "./imports.ts"

describe("loadedImports", () => {
  const text = [
    "// pine·trie — a comment before, with characters past ASCII",
    'import { b, type B } from "./b.ts"',
    'import type { C } from "./c.ts"',
    'export * from "@pinetrie/core"',
    'export type { D } from "./d.ts"',
    "type E = typeof import('./e.ts')",
    'const f = await import("./f.ts")',
    `const g = await import(\`./${"$"}{name}.ts\`)`,
  ].join("\n")

  test("static imports, re-exports and literal import() calls, each once, at their string's place", () => {
    const found = loadedImports("a.ts", text)
    expect(
      found.map(i =>
        i.kind === "literal"
          ? [i.specifier, i.dynamic, text.slice(i.start, i.end)]
          : ["computed"],
      ),
    ).toEqual([
      ["./b.ts", false, '"./b.ts"'],
      ["@pinetrie/core", false, '"@pinetrie/core"'],
      ["./f.ts", true, '"./f.ts"'],
      ["computed"],
    ])
  })

  test("a whole import type or export type loads nothing, nor a type's import()", () => {
    const specifiers = loadedImports("a.ts", text).flatMap(i =>
      i.kind === "literal" ? [i.specifier] : [],
    )
    expect(specifiers).not.toContain("./c.ts")
    expect(specifiers).not.toContain("./d.ts")
    expect(specifiers).not.toContain("./e.ts")
  })
})

test("reachable: the entries and all they load, through a cycle without looping", () => {
  const graph = new Map([
    ["a", ["b"]],
    ["b", ["c", "a"]],
    ["c", []],
    ["d", ["a"]],
  ])
  expect([...reachable(graph, ["a"])].sort()).toEqual(["a", "b", "c"])
  expect([...reachable(graph, ["c"])]).toEqual(["c"])
})
