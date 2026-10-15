// scripts/budget — the test budget, a square-root rule: each layer of the
// suites holds at most ⌊√n⌋ tests, where n is the layer below it.
//
//   L1 unit          Vitest's `test()`s, beside the code
//   L2 acceptance   the host's, the lanes' and the observer's scenarios
//                   (`e2e`, `e2e:lanes`, `e2e:observer`)
//   L3 browser       the browser's scenarios (`e2e:browser`)
//
// A test above L1 is a scenario (`apps/pinetrie/e2e/scenario.ts`): one run
// against its own host, which holds many checks, as one `test()` holds many
// `expect()`s. `pnpm run conformance` is pi's own Storage suite, run against
// ours: its tests are pi's, so they count in no layer.
//
// A scenario's fixed waits are its other cost: each is paid in full on every
// run, and guesses when a state comes. `FIXED_WAITS` lists the few left.
//
// And no test or scenario reads a duration: its verdict would hang on the
// machine's load. A clock reading subtracted is refused everywhere.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { scenarioNames } from "../apps/pinetrie/e2e/scenario.ts"

export interface LayerCounts {
  /** Static `test(`/`it(` calls in Vitest's include globs: `test.each` counts once. */
  readonly unit: number
  /** `host/*.scenario.ts`, `lanes/*.scenario.ts` and `observer/*.scenario.ts`. */
  readonly acceptance: number
  /** `browser/*.scenario.ts`. */
  readonly browser: number
}

/** What breaks the square-root rule, worded; empty when nothing does. Pure. */
export function budgetBreaches(c: LayerCounts): readonly string[] {
  const allowed = (below: number) => Math.floor(Math.sqrt(below))
  return [
    ...(c.acceptance > allowed(c.unit)
      ? [
          `\${c.acceptance} acceptance scenarios: \${c.unit} unit tests allow \${allowed(c.unit)}`,
        ]
      : []),
    ...(c.browser > allowed(c.acceptance)
      ? [
          `\${c.browser} browser scenarios: \${c.acceptance} acceptance scenarios allow \${allowed(c.acceptance)}`,
        ]
      : []),
  ]
}

/**
 * The unit test files, by path from `root`: `vitest.config.mjs`'s own
 * `test.include`, so the list follows the config.
 */
export async function unitTestFiles(root: string): Promise<readonly string[]> {
  const config = (await import(path.join(root, "vitest.config.mjs"))) as {
    default: {
      test: { include: readonly string[]; exclude: readonly string[] }
    }
  }
  const { include } = config.default.test
  return [
    ...new Set(
      include.flatMap(glob =>
        globSync(glob, { cwd: root }).filter(f => !f.includes("node_modules")),
      ),
    ),
  ]
}

/** The suites, by their directory under `apps/pinetrie/e2e`. */
const SUITES = ["host", "lanes", "observer", "browser"] as const

/** Every suite's scenario files, by path from `root`. */
export const scenarioFiles = (root: string): readonly string[] =>
  SUITES.flatMap(suite => {
    const dir = path.join("apps/pinetrie/e2e", suite)
    return scenarioNames(path.join(root, dir)).map(name =>
      path.join(dir, `${name}.scenario.ts`),
    )
  })

/** A `test(`, `it(` or `test.each(…)(` at a statement's start. */
const UNIT_TEST = /^\s*(?:test|it)(?:\.each\(.*\))?\(/gm

/** Count the layers in the repository at `root`. */
export async function countLayers(root: string): Promise<LayerCounts> {
  const files = await unitTestFiles(root)
  const unit = files.reduce(
    (n, f) =>
      n +
      (readFileSync(path.join(root, f), "utf8").match(UNIT_TEST) ?? []).length,
    0,
  )
  const browser = scenarioFiles(root).filter(f =>
    f.startsWith("apps/pinetrie/e2e/browser/"),
  ).length
  return {
    unit,
    acceptance: scenarioFiles(root).length - browser,
    browser,
  }
}

/**
 * The fixed waits each scenario still holds, by path from the repository's
 * root: waits for time, not for a state. A scenario not listed holds none.
 * An entry only shrinks, and is deleted at zero.
 */
export const FIXED_WAITS: Readonly<Record<string, number>> = {
  // A write and a deletion of one key in one millisecond tie on other peers
  // (Kyneta: `docs/pinetrie.md`, "Open, non-blocking").
  "apps/pinetrie/e2e/host/presence.scenario.ts": 1,
  // The foreground `sleep`s a tool's timeout and Stop kill, and the
  // process list searched for one: their death is checked, not waited out.
  "apps/pinetrie/e2e/lanes/main.scenario.ts": 3,
}

/**
 * `waitForTimeout(`, `sleep(`, `setTimeout(`, and a shell `sleep N` that
 * is not sent to the background (`sleep N &`).
 */
const FIXED_WAIT =
  /waitForTimeout\(|\bsleep\(|\bsetTimeout\(|\bsleep \d+(?:\.\d+)?(?![\d.])(?!\s*&(?!&))/g

/** The fixed waits in a scenario's source. */
export const fixedWaitsIn = (source: string): number =>
  (source.match(FIXED_WAIT) ?? []).length

/** What breaks `allowed`, worded; empty when nothing does. */
export function fixedWaitBreaches(
  counts: Readonly<Record<string, number>>,
  allowed: Readonly<Record<string, number>> = FIXED_WAITS,
): readonly string[] {
  const files = [...new Set([...Object.keys(counts), ...Object.keys(allowed)])]
  return files.sort().flatMap(file => {
    const has = counts[file] ?? 0
    const may = allowed[file] ?? 0
    if (has > may)
      return [
        `${file} holds ${has} fixed waits, FIXED_WAITS allows ${may}: wait for a state instead`,
      ]
    if (has < may)
      return [
        `${file} holds ${has} fixed waits: lower its FIXED_WAITS entry from ${may}`,
      ]
    return []
  })
}

/** Each scenario's fixed waits, by path from `root`. */
export function countFixedWaits(root: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of scenarioFiles(root)) {
    const n = fixedWaitsIn(readFileSync(path.join(root, file), "utf8"))
    if (n > 0) counts[file] = n
  }
  return counts
}

/** `Date.now()` or `performance.now()`, then a minus: a duration read. */
const ELAPSED = /\b(?:Date|performance)\.now\(\)\s*-/g

/** The durations a source reads from a clock. */
export const elapsedReadingsIn = (source: string): number =>
  (source.match(ELAPSED) ?? []).length

/** The durations each test and scenario reads, by path from `root`; only files that read one. */
export async function countElapsedReadings(
  root: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const file of [...(await unitTestFiles(root)), ...scenarioFiles(root)]) {
    const n = elapsedReadingsIn(readFileSync(path.join(root, file), "utf8"))
    if (n > 0) counts[file] = n
  }
  return counts
}

/** Each file that reads a duration, worded; no file may. */
export const elapsedBreaches = (
  counts: Readonly<Record<string, number>>,
): readonly string[] =>
  Object.keys(counts)
    .sort()
    .map(
      file =>
        `${file} reads elapsed time from a clock: a check reads a state, a count or a result, never a duration`,
    )
