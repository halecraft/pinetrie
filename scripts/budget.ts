// scripts/budget — the test budget, a square-root rule: each layer of the
// suites holds at most ⌊√n⌋ tests, where n is the layer below it.
//
//   L1 unit          Vitest's `test()`s, beside the code
//   L2 acceptance   the host's and the lanes' scenarios (`e2e`, `e2e:lanes`)
//   L3 browser       the browser's scenarios (`e2e:browser`)
//
// A test above L1 is a scenario (`apps/pinetrie/e2e/scenario.ts`): one run
// against its own host, which holds many checks, as one `test()` holds many
// `expect()`s. `pnpm run conformance` is pi's own Storage suite, run against
// ours: its tests are pi's, so they count in no layer.

import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { scenarioNames } from "../apps/pinetrie/e2e/scenario.ts"

export interface LayerCounts {
  /** Static `test(`/`it(` calls in Vitest's include globs: `test.each` counts once. */
  readonly unit: number
  /** `host/*.scenario.ts` and `lanes/*.scenario.ts`. */
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

/** A `test(`, `it(` or `test.each(…)(` at a statement's start. */
const UNIT_TEST = /^\s*(?:test|it)(?:\.each\(.*\))?\(/gm

/**
 * Count the layers in the repository at `root`. The unit globs are
 * `vitest.config.mjs`'s own `test.include`, so the count follows the config.
 */
export async function countLayers(root: string): Promise<LayerCounts> {
  const config = (await import(path.join(root, "vitest.config.mjs"))) as {
    default: {
      test: { include: readonly string[]; exclude: readonly string[] }
    }
  }
  const { include } = config.default.test
  const files = new Set(
    include.flatMap(glob =>
      globSync(glob, { cwd: root }).filter(f => !f.includes("node_modules")),
    ),
  )
  const unit = [...files].reduce(
    (n, f) =>
      n +
      (readFileSync(path.join(root, f), "utf8").match(UNIT_TEST) ?? []).length,
    0,
  )
  const e2e = path.join(root, "apps/pinetrie/e2e")
  return {
    unit,
    acceptance:
      scenarioNames(path.join(e2e, "host")).length +
      scenarioNames(path.join(e2e, "lanes")).length,
    browser: scenarioNames(path.join(e2e, "browser")).length,
  }
}
