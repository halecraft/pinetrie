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
import type { LaneHosts } from "./lane-hosts.ts"

/** What a scenario is given beside its checks. */
export interface Given {
  readonly lanes: LaneHosts
}

/**
 * A scenario. One whose agent has tools declares `lanes: true`: it is skipped
 * where the suites' runtime cannot run (`runtimeProblem`), and only it is
 * given hosts with lanes.
 */
export type Scenario =
  | {
      readonly lanes?: false
      /** Why it cannot run in this environment, or null: `PINETRIE_LIVE` unset. */
      readonly needs?: () => Promise<string | null>
      run(checks: Checks): Promise<void>
    }
  | {
      readonly lanes: true
      readonly needs?: () => Promise<string | null>
      run(checks: Checks, given: Given): Promise<void>
    }

/**
 * Why a scenario cannot run here, or null: the runtime's reason first, for
 * one that runs lanes, then its own `needs`.
 */
export function scenarioProblem(input: {
  readonly lanes: boolean
  /** `runtimeProblem`'s answer; asked only for a scenario that runs lanes. */
  readonly runtime: string | null
  readonly needs: string | null
}): string | null {
  return (input.lanes ? input.runtime : null) ?? input.needs
}

/** The file suffix that makes a file a scenario; its stem is its name. */
export const SCENARIO_SUFFIX = ".scenario.ts"

/**
 * Which scenario names to run: all, or those `named` (`PINETRIE_SCENARIO`, a
 * comma-separated list) names, in name order.
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
 * reason its `needs` gave (`problems`, by name; absent or null runs it).
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
  // Imported, and the runtime asked, once, and only for a suite with a
  // scenario that runs lanes.
  let hosts: Promise<typeof import("./lane-hosts.ts")> | null = null
  let runtime: Promise<string | null> | null = null
  const laneHosts = () => {
    hosts ??= import("./lane-hosts.ts")
    return hosts
  }
  for (const name of chosen) {
    const mod = (await import(
      pathToFileURL(path.join(dir, `${name}${SCENARIO_SUFFIX}`)).href
    )) as { scenario: Scenario }
    scenarios.set(name, mod.scenario)
    const lanes = mod.scenario.lanes === true
    if (lanes) runtime ??= laneHosts().then(m => m.runtimeProblem())
    problems.set(
      name,
      scenarioProblem({
        lanes,
        runtime: lanes ? await runtime : null,
        needs: (await mod.scenario.needs?.()) ?? null,
      }),
    )
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
        const scenario = scenarios.get(step.name)
        if (scenario?.lanes === true)
          await scenario.run(checks, { lanes: (await laneHosts()).laneHosts })
        else await scenario?.run(checks)
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
