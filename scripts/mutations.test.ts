import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { SCENARIO_SUFFIX } from "../apps/pinetrie/e2e/scenario.ts"
import { type Mutation, SUITES } from "./mutate.ts"
import { callsCheck, labelsIn, proofGaps } from "./proofs.ts"
import { UNPROVEN } from "./unproven.ts"

/** The suites' own machinery, which defines `check` rather than calling it. */
const FRAMEWORK = [
  "checks.ts",
  "checks.test.ts",
  "scenario.ts",
  "scenario.test.ts",
]

// Every mutation list stays runnable: each anchor must still occur exactly
// once in its file. Code moves under the lists, and a drifted anchor would
// report ANCHOR only when someone next runs the (slow) list. This is fast.
const dir = path.join(import.meta.dirname, "mutations")
const root = path.join(import.meta.dirname, "..")

describe("mutation lists", async () => {
  for (const file of readdirSync(dir)
    .filter(f => f.endsWith(".ts"))
    .sort()) {
    const { mutations } = (await import(path.join(dir, file))) as {
      mutations: readonly Mutation[]
    }
    test(`${file}: every anchor occurs exactly once`, () => {
      const drifted = mutations
        .filter(m => {
          const text = readFileSync(path.join(root, m.file), "utf8")
          return text.split(m.from).length !== 2
        })
        .map(m => m.name)
      expect(drifted).toEqual([])
    })
  }
})

describe("every suite check is proven, and every suite mutation names one", async () => {
  const e2e = path.join(root, "apps/pinetrie/e2e")
  const labels = new Map<string, readonly string[]>()
  let nonLiteral = 0
  const stray: string[] = []
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [path.join(dir, e.name)]
          : [],
    )
  for (const file of walk(e2e)) {
    const source = readFileSync(file, "utf8")
    const rel = path.relative(e2e, file)
    if (rel.endsWith(SCENARIO_SUFFIX)) {
      const found = labelsIn(source)
      labels.set(rel.slice(0, -SCENARIO_SUFFIX.length), found.labels)
      nonLiteral += found.nonLiteral
    } else if (!FRAMEWORK.includes(rel) && callsCheck(source)) stray.push(rel)
  }
  const mutations = (
    await Promise.all(
      readdirSync(dir)
        .filter(f => f.endsWith(".ts"))
        .map(
          async f =>
            (
              (await import(path.join(dir, f))) as {
                mutations: readonly Mutation[]
              }
            ).mutations,
        ),
    )
  ).flat()
  const gaps = proofGaps({
    labels,
    mutations,
    dirOf: m => path.basename(SUITES[m.suite].dir),
    checkCallers: stray,
  })
  // The unproven checks are exactly `UNPROVEN`'s: a new check needs a
  // mutation, and an entry proven or deleted leaves the list.
  test("no check is unproven but those UNPROVEN lists, and each of those still is", () =>
    expect(gaps.unproven.map(u => `${u.scenario}: ${u.label}`).sort()).toEqual(
      Object.entries(UNPROVEN)
        .flatMap(([s, ls]) => ls.map(l => `${s}: ${l}`))
        .sort(),
    ))
  test("no suite mutation names a scenario or check that is not there", () =>
    expect(gaps.unknown).toEqual([]))
  test("no label occurs twice in a scenario", () =>
    expect(gaps.duplicates).toEqual([]))
  test("only scenarios call check(, and always with a literal label", () => {
    expect(gaps.stray).toEqual([])
    expect(nonLiteral).toBe(0)
  })
})
