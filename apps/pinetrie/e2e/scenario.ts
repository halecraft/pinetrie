// e2e/scenario — a suite as a set of scenarios, one per `*.scenario.ts` file.
//
// A scenario is to a suite what a `test()` is to Vitest: it starts its own
// host and depends on no other scenario, so a suite may run each in a
// process of its own (`planJobs`). `PINETRIE_SCENARIO` runs some, as a suite
// mutation does (`scripts/mutate.ts`, `SUITES`).

import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  type Checks,
  createChecks,
  isStop,
  NO_COUNTS,
  readSuiteCounts,
  SUITE_MARK,
  sumSuiteCounts,
} from "./checks.ts"
import type { LaneHosts } from "./lane-hosts.ts"
import type { SuiteRequirement } from "./requirements.ts"

/** What a scenario is given beside its checks. */
export interface Given {
  readonly lanes: LaneHosts
}

/**
 * A scenario. One whose agent has tools declares `lanes: true`: it requires
 * a runtime for lanes, and only it is given hosts with lanes. What else it
 * needs of the place it runs in is its `requires`; one not met skips it.
 */
export type Scenario =
  | {
      readonly lanes?: false
      readonly requires?: readonly SuiteRequirement[]
      run(checks: Checks): Promise<void>
    }
  | {
      readonly lanes: true
      readonly requires?: readonly SuiteRequirement[]
      run(checks: Checks, given: Given): Promise<void>
    }

/** A requirement a scenario named and this place does not meet. */
export interface Unmet {
  readonly requirement: SuiteRequirement
  /** What this place lacks, in its probe's words. */
  readonly why: string
}

/**
 * What a scenario requires, in the order it is asked: a runtime for lanes
 * when it runs them, its suite's (`runSuite`), then its own.
 */
export const scenarioRequirements = (
  scenario: Pick<Scenario, "lanes" | "requires">,
  suite: readonly SuiteRequirement[],
): readonly SuiteRequirement[] => [
  ...new Set<SuiteRequirement>([
    ...(scenario.lanes === true ? (["lane-runtime"] as const) : []),
    ...suite,
    ...(scenario.requires ?? []),
  ]),
]

/** The first of `requirements` this place does not meet, by `facts`, or null. */
export function scenarioProblem(
  requirements: readonly SuiteRequirement[],
  facts: ReadonlyMap<SuiteRequirement, string | null>,
): Unmet | null {
  for (const requirement of requirements) {
    const why = facts.get(requirement) ?? null
    if (why !== null) return { requirement, why }
  }
  return null
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
  | { readonly name: string; readonly run: false; readonly why: Unmet }

type SuitePlan =
  | { readonly kind: "unknown"; readonly names: readonly string[] }
  | { readonly kind: "run"; readonly steps: readonly SuiteStep[] }

/**
 * What a suite does: the chosen scenarios, each run, or skipped for the
 * requirement it names that this place does not meet (`problems`, by name;
 * absent or null runs it).
 */
export function planSuite(
  all: readonly string[],
  named: string | undefined,
  problems: ReadonlyMap<string, Unmet | null>,
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

/** How a suite's runnable scenarios run. */
export type JobPlan =
  /** In this process, one after another. */
  | { readonly kind: "here" }
  /**
   * Each in a process of its own (`PINETRIE_SCENARIO`), `atOnce` at a time,
   * of which `lanesAtOnce` at most run lanes.
   */
  | {
      readonly kind: "processes"
      readonly atOnce: number
      readonly lanesAtOnce: number
    }

/**
 * Where a suite's scenarios run. A stop at a check (`PINETRIE_STOP_AT`)
 * ends the whole suite, which only one process can do, so it runs here, as
 * does a suite with one scenario to run: every suite mutant's.
 */
export function planJobs(input: {
  readonly steps: readonly SuiteStep[]
  /** The most processes at once the suite allows. */
  readonly jobs: SuiteJobs
  readonly stopAt: string | undefined
}): JobPlan {
  const runnable = input.steps.filter(s => s.run).length
  const { all, lanes } = input.jobs
  return all <= 1 || input.stopAt !== undefined || runnable <= 1
    ? { kind: "here" }
    : {
        kind: "processes",
        atOnce: Math.min(all, runnable),
        lanesAtOnce: Math.max(1, Math.min(lanes, all)),
      }
}

/** How many scenarios a suite runs at once, and how many of those may run lanes. */
export interface SuiteJobs {
  readonly all: number
  readonly lanes: number
}

/** One scenario at a time: today's suite in one process. */
export const ONE_AT_A_TIME: SuiteJobs = { all: 1, lanes: 1 }

/**
 * What a scenario's own process printed, without the suite's title, tally
 * and marked line around it, which the suite prints once for all of them.
 */
export const scenarioSection = (output: string, title: string): string =>
  output
    .split("\n")
    .filter(
      l =>
        l !== `=== ${title} ===` &&
        !l.startsWith(`=== ${title}: `) &&
        !l.startsWith(SUITE_MARK),
    )
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")

/** The scenario names in `dir`: its `*.scenario.ts` files' stems. */
export const scenarioNames = (dir: string): readonly string[] =>
  readdirSync(dir)
    .filter(f => f.endsWith(SCENARIO_SUFFIX))
    .map(f => f.slice(0, -SCENARIO_SUFFIX.length))
    .sort()

/**
 * Gather (the scenarios in `dir`, the chosen ones imported, each requirement
 * they name asked once, `suiteFact`), plan (`planSuite`), then run the plan
 * and report. `requires` is every scenario's in this suite. A scenario that
 * throws fails under its name and the next one runs; a stop at
 * `PINETRIE_STOP_AT` ends the suite.
 */
export async function runSuite(
  title: string,
  dir: string,
  jobs: SuiteJobs = ONE_AT_A_TIME,
  requires: readonly SuiteRequirement[] = [],
): Promise<never> {
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
  const problems = new Map<string, Unmet | null>()
  // Imported once, and only for a suite with a scenario that runs lanes.
  let hosts: Promise<typeof import("./lane-hosts.ts")> | null = null
  const laneHosts = () => {
    hosts ??= import("./lane-hosts.ts")
    return hosts
  }
  // Each requirement asked once, and only when a chosen scenario names it:
  // the probes load pi, the VM's and Docker's modules.
  const facts = new Map<SuiteRequirement, string | null>()
  let probes: Promise<typeof import("./suite-facts.ts")> | null = null
  for (const name of chosen) {
    const mod = (await import(
      pathToFileURL(path.join(dir, `${name}${SCENARIO_SUFFIX}`)).href
    )) as { scenario: Scenario }
    scenarios.set(name, mod.scenario)
    const requirements = scenarioRequirements(mod.scenario, requires)
    // Asked in order until one is not met: the first is the reason given.
    for (const r of requirements) {
      if (!facts.has(r)) {
        probes ??= import("./suite-facts.ts")
        facts.set(r, await (await probes).suiteFact(r))
      }
      if (facts.get(r) !== null) break
    }
    problems.set(name, scenarioProblem(requirements, facts))
  }
  const plan = planSuite(all, named, problems)
  if (plan.kind === "run") {
    const jobPlan = planJobs({
      steps: plan.steps,
      jobs,
      stopAt: process.env.PINETRIE_STOP_AT,
    })
    if (jobPlan.kind === "processes")
      return runInProcesses(title, plan.steps, jobPlan, {
        runsLanes: name => scenarios.get(name)?.lanes === true,
        laneHosts,
      })
  }
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

/**
 * Each runnable scenario in a process of its own, `atOnce` at a time, its
 * output printed whole once it ends, in name order, then one tally of all.
 * With a scenario that runs lanes, the lane images are made ready first, once.
 */
async function runInProcesses(
  title: string,
  steps: readonly SuiteStep[],
  plan: Extract<JobPlan, { kind: "processes" }>,
  options: {
    readonly runsLanes: (name: string) => boolean
    readonly laneHosts: () => Promise<typeof import("./lane-hosts.ts")>
  },
): Promise<never> {
  const checks = createChecks()
  console.log(`\n=== ${title} ===`)
  if (steps.some(s => s.run && options.runsLanes(s.name))) {
    console.log("\n── lane images")
    try {
      const tag = await (await options.laneHosts()).prepareSuiteImages()
      console.log(`  ready  ${tag}`)
    } catch (error) {
      checks.error(
        "lane images",
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  const all = slots(plan.atOnce)
  const lanes = slots(plan.lanesAtOnce)
  const runs = new Map(
    steps
      .filter(s => s.run)
      .map(s => {
        const held = options.runsLanes(s.name) ? [lanes, all] : [all]
        return [s.name, holding(held, () => scenarioProcess(s.name))] as const
      }),
  )
  let children = NO_COUNTS
  for (const step of steps) {
    const run = runs.get(step.name)
    if (run === undefined) {
      console.log(`\n── ${step.name}`)
      if (!step.run) checks.skip(step.name, step.why)
      continue
    }
    const { output, status } = await run
    console.log(`\n${scenarioSection(output, title)}`)
    const counts = readSuiteCounts(output)
    if (counts === null)
      checks.error(step.name, `its process exited ${status} with no tally`)
    else children = sumSuiteCounts(children, counts)
  }
  return checks.report(title, children)
}

/** A count of slots: `take` waits for one, `give` hands it back. */
function slots(count: number): {
  readonly take: () => Promise<void>
  readonly give: () => void
} {
  let used = 0
  const waiting: (() => void)[] = []
  return {
    take: async () => {
      if (used >= count)
        await new Promise<void>(resolve => waiting.push(resolve))
      used++
    },
    give: () => {
      used--
      waiting.shift()?.()
    },
  }
}

/**
 * `body` once a slot of each of `held` is taken, in order, given back after.
 * Every caller takes them in the same order, so none waits on another's.
 */
async function holding<T>(
  held: readonly ReturnType<typeof slots>[],
  body: () => Promise<T>,
): Promise<T> {
  for (const s of held) await s.take()
  try {
    return await body()
  } finally {
    for (const s of held) s.give()
  }
}

/** This suite's runner again, for the scenario `name` alone: its output, stdout and stderr as they came, and its exit status. */
function scenarioProcess(
  name: string,
): Promise<{ readonly output: string; readonly status: number | null }> {
  return new Promise(resolve => {
    const runner = process.argv[1]
    if (runner === undefined) {
      resolve({ output: "no runner to start", status: null })
      return
    }
    const child = spawn(process.execPath, [...process.execArgv, runner], {
      env: { ...process.env, PINETRIE_SCENARIO: name },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", d => {
      output += d
    })
    child.stderr.on("data", d => {
      output += d
    })
    child.on("close", status => resolve({ output, status }))
  })
}
