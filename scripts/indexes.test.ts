import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  exportStatement,
  gatherIndexes,
  type IndexInput,
  planIndexes,
} from "./indexes.ts"

const ROOT = path.join(import.meta.dirname, "..")

const PKG = { name: "@pinetrie/p", dir: "packages/p" }
const HEAD = "// p — a package.\n"

/** A repo of one indexed package, its modules and index, and the files outside it. */
const repo = (
  modules: Record<string, string>,
  outside: Record<string, string>,
  index = HEAD,
): IndexInput => ({
  packages: [PKG],
  sources: [
    { file: "packages/p/index.ts", text: index },
    ...Object.entries(modules).map(([m, text]) => ({
      file: `packages/p/${m}`,
      text,
    })),
    ...Object.entries(outside).map(([file, text]) => ({ file, text })),
  ],
})

describe("planIndexes", () => {
  test("an index holds each name imported through it, from its module, and nothing else", () => {
    const plan = planIndexes(
      repo(
        {
          "a.ts": "export const used = 1\nexport const unused = 2\n",
          "b.ts": "export interface Shape {}\nexport function make() {}\n",
        },
        {
          "packages/q/x.ts":
            'import { used } from "@pinetrie/p"\nimport type { Shape } from "@pinetrie/p"\n',
          "packages/p/b.test.ts": 'import { make } from "./index.ts"\n',
        },
      ),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.writes).toEqual([
      {
        file: "packages/p/index.ts",
        text: `${HEAD}\nexport { used } from "./a.ts"\nexport { make, type Shape } from "./b.ts"\n`,
      },
    ])
  })

  test("an index already as written is not written", () => {
    const index = `${HEAD}\nexport { used } from "./a.ts"\n`
    const plan = planIndexes(
      repo(
        { "a.ts": "export const used = 1\n" },
        { "packages/q/x.ts": 'import { used } from "@pinetrie/p"\n' },
        index,
      ),
    )
    expect(plan).toEqual({ writes: [], refusals: [] })
  })

  test("a name imported as a value anywhere is exported as a value", () => {
    const plan = planIndexes(
      repo(
        { "a.ts": "export const k = 1\n" },
        {
          "packages/q/x.ts": 'import type { k } from "@pinetrie/p"\n',
          "packages/q/y.ts": 'import { k } from "@pinetrie/p"\n',
        },
      ),
    )
    expect(plan.writes[0]?.text).toContain('export { k } from "./a.ts"')
  })

  test("a name no module exports, one two modules export, and a whole import are refused", () => {
    const plan = planIndexes(
      repo(
        {
          "a.ts": "export const twice = 1\n",
          "b.ts": "export const twice = 2\n",
        },
        {
          "packages/q/x.ts":
            'import { missing, twice } from "@pinetrie/p"\nimport * as all from "@pinetrie/p"\n',
        },
      ),
    )
    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        {
          kind: "not-exported",
          package: "@pinetrie/p",
          name: "missing",
          file: "packages/q/x.ts",
        },
        {
          kind: "two-modules",
          package: "@pinetrie/p",
          name: "twice",
          modules: ["./a.ts", "./b.ts"],
        },
        {
          kind: "whole-import",
          package: "@pinetrie/p",
          file: "packages/q/x.ts",
        },
      ]),
    )
  })

  test("a module's re-exports are its exports, and an overloaded function is one name", () => {
    const plan = planIndexes(
      repo(
        {
          "again.ts":
            'export type { Other } from "@pinetrie/q"\nexport function f(a: 1): 1\nexport function f(a: number) { return a }\n',
        },
        { "packages/r/x.ts": 'import { f, type Other } from "@pinetrie/p"\n' },
      ),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.writes[0]?.text).toContain(
      'export { f, type Other } from "./again.ts"',
    )
  })
})

test("exportStatement: one line within 80 columns, else one name a line, as Biome lays it out", () => {
  expect(exportStatement([{ name: "a", typeOnly: true }], "./m.ts")).toBe(
    'export type { a } from "./m.ts"',
  )
  const long = [
    "alpha",
    "Bravo",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
  ]
  expect(
    exportStatement(
      long.map(name => ({ name, typeOnly: false })),
      "./module.ts",
    ),
  ).toBe(
    'export {\n  alpha,\n  Bravo,\n  bravo,\n  charlie,\n  delta,\n  echo,\n  foxtrot,\n  golf,\n} from "./module.ts"',
  )
})

test("every indexed package's index is as `pnpm run indexes` writes it", () => {
  const plan = planIndexes(gatherIndexes(ROOT))
  expect(plan.refusals).toEqual([])
  expect(plan.writes.map(w => w.file)).toEqual([])
})
