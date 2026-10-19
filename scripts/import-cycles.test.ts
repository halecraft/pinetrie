import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  ALLOWED_CYCLES,
  importCycles,
  readImportCycles,
} from "./import-cycles.ts"
import { loadedSpecifiers } from "./imports.ts"

const ROOT = path.join(import.meta.dirname, "..")

describe("loadedSpecifiers", () => {
  test("every relative import and re-export loads, each once; a whole `import type` or `export type` does not", () => {
    expect(
      loadedSpecifiers(
        "a.ts",
        [
          'import { b } from "./b.ts"',
          'import { type C } from "./c.ts"',
          'import type { D } from "./d.ts"',
          'import "./e.ts"',
          'export { f } from "./f.ts"',
          'export * from "../g.ts"',
          'export type { H } from "./h.ts"',
          'import { i } from "@pinetrie/i"',
          'import { b2 } from "./b.ts"',
          "export const j = 1",
        ].join("\n"),
      ),
    ).toEqual(["./b.ts", "./c.ts", "./e.ts", "./f.ts", "../g.ts"])
  })
})

describe("importCycles", () => {
  const cycles = (edges: Record<string, readonly string[]>) =>
    importCycles(new Map(Object.entries(edges)))

  test("a chain and a diamond hold no cycle", () => {
    expect(
      cycles({ a: ["b", "c"], b: ["d"], c: ["d"], d: [], e: ["a", "d"] }),
    ).toEqual([])
  })

  test("each cycle is its modules sorted, the cycles by their first module", () => {
    expect(
      cycles({ z: ["y"], y: ["x"], x: ["z", "c"], c: ["b"], b: ["c"] }),
    ).toEqual([
      ["b", "c"],
      ["x", "y", "z"],
    ])
  })

  test("a module that loads itself is a cycle", () => {
    expect(cycles({ a: ["a"], b: [] })).toEqual([["a"]])
  })
})

test("the source holds no import cycle but those allowed", () => {
  expect(readImportCycles(ROOT)).toEqual(ALLOWED_CYCLES)
})
