// e2e/scenario — a suite as a set of scenarios, one per `*.scenario.ts` file.
//
// A scenario is to a suite what a `test()` is to Vitest: it starts its own
// host, depends on no other scenario, and is the unit the test budget counts
// (`scripts/budget.ts`). `PINETRIE_SCENARIO` runs some, as a suite mutation
// does (`scripts/mutate.ts`, `SUITES`).

import { readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { type Checks, createChecks, isStop } from "./checks.ts"

export interface Scenario {
  /**
   * Why it cannot run in this environment, or null: `container` missing
   * (`runtimeProblem`, `harness.ts`), or `PINETRIE_LIVE` unset.
   */
  readonly needs?: () => Promise<string | null>
  run(checks: Checks): Promise<void>
}

/** The file suffix that makes a file a scenario; its stem is its name. */
export const SCENARIO_SUFFIX = ".scenario.ts"

/**
 * Which scenario names to run: all, or those `named` (`PINETRIE_SCENARIO`, a
 * comma-separated list) names, in name order. Pure.
 */
export function chooseScenarios(
  all: readonly string[],
  named: string | undefined,
): readonly string[] | { readonly unknown: readonly string[] } {
  const asked = (named ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s !== "")
  if (asked.length === 0) return [...all].sort()
  const unknown = asked.filter(n => !all.includes(n))
  if (unknown.length > 0) return { unknown }
  return [...all].filter(n => asked.includes(n)).sort()
}

export type SuiteStep =
  | { readonly name: string; readonly run: true }
  | { readonly name: string; readonly run: false; readonly why: string }

export type SuitePlan =
  | { readonly kind: "unknown"; readonly names: readonly string[] }
  | { readonly kind: "run"; readonly steps: readonly SuiteStep[] }

/**
 * What a suite does: the chosen scenarios, each run, or skipped for the
 * reason its `needs` gave (`problems`, by name; absent or null runs it). Pure.
 */
export function planSuite(
  all: readonly string[],
  named: string | undefined,
  problems: ReadonlyMap<string, string | null>,
): SuitePlan {
  const chosen = chooseScenarios(all, named)
  if ("unknown" in chosen) return { kind: "unknown", names: chosen.unknown }
  return {
    kind: "run",
    steps: chosen.map(name => {
      const why = problems.get(name) ?? null
      return why === null ? { name, run: true } : { name, run: false, why }
    }),
  }
}

/** The scenario names in `dir`: its `*.scenario.ts` files' stems. */
export const scenarioNames = (dir: string): readonly string[] =>
  readdirSync(dir)
    .filter(f => f.endsWith(SCENARIO_SUFFIX))
    .map(f => f.slice(0, -SCENARIO_SUFFIX.length))
    .sort()

/**
 * Gather (the scenarios in `dir`, the chosen ones imported, each one's
 * `needs` awaited), plan (`planSuite`), then run the plan and report. A
 * scenario that throws fails under its name and the next one runs; a stop at
 * `PINETRIE_STOP_AT` ends the suite.
 */
export async function runSuite(title: string, dir: string): Promise<never> {
  const all = scenarioNames(dir)
  const named = process.env.PINETRIE_SCENARIO
  const chosen = chooseScenarios(all, named)
  if ("unknown" in chosen) {
    console.error(
      `no scenario ${chosen.unknown.join(", ")} in ${title}: PINETRIE_SCENARIO takes ${all.join(", ")}`,
    )
    process.exit(2)
  }
  const scenarios = new Map<string, Scenario>()
  const problems = new Map<string, string | null>()
  for (const name of chosen) {
    const mod = (await import(
      pathToFileURL(path.join(dir, `${name}${SCENARIO_SUFFIX}`)).href
    )) as { scenario: Scenario }
    scenarios.set(name, mod.scenario)
    problems.set(name, (await mod.scenario.needs?.()) ?? null)
  }
  const plan = planSuite(all, named, problems)
  const checks = createChecks()
  console.log(`\n=== ${title} ===`)
  if (plan.kind === "run")
    for (const step of plan.steps) {
      console.log(`\n── ${step.name}`)
      if (!step.run) {
        checks.skip(step.name, step.why)
        continue
      }
      try {
        await scenarios.get(step.name)?.run(checks)
      } catch (error) {
        if (isStop(error)) break
        checks.error(
          step.name,
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        )
      }
    }
  return checks.report(title)
}
