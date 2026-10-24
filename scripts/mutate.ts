// scripts/mutate — prove each check can fail, by the same rules every time.
//
// "A check without a proof it can fail is not yet a check." A mutation breaks
// the code under test in one exact place; the check aimed at it must then
// fail. Each plan used to hand-write this loop, and each copy had to remember
// the same rules. They live here once:
//
//   - The anchor must occur EXACTLY once, or the mutation reports ANCHOR and
//     runs nothing: a drifted anchor would otherwise silently test nothing.
//   - The file is ALWAYS restored, even when the run throws or is interrupted.
//   - A mutant that does not load (a syntax or type-strip error) is BROKEN,
//     not killed: it proves nothing about the check.
//   - With `expect`, the run must fail WITH that check: a mutant that breaks
//     some other check is ELSEWHERE, because the intended check did not fire.
//   - A run that times out is KILLED (hung): a guard against spinning, removed,
//     makes the suite hang, and a hang is a failure.
//   - With `expect`, a suite stops at that check (`PINETRIE_STOP_AT`,
//     `apps/pinetrie/e2e/checks.ts`): nothing after it changes the result.
//   - A suite mutation runs only its scenario (`PINETRIE_SCENARIO`,
//     `apps/pinetrie/e2e/scenario.ts`), with its suite's command (`SUITES`).
//   - A unit mutation's `vitest run` runs only the files and tests its
//     `expect` names (`narrowedCommand`), from one `vitest list` per batch.
//   - A unit mutation's command must pass with nothing mutated, run once per
//     batch however many mutants share it, or its mutants read BASELINE and
//     run nothing: a kill there would prove no bug.
//   - A unit mutation whose tests all skip here, for what they require of the
//     place (`apps/pinetrie/e2e/requirements.ts`), runs in a throwaway lane
//     when this place can make one (`apps/pinetrie/scripts/test-lane.ts`, one
//     lane per call, each mutant's file sent in and put back), or reads
//     NOT-HERE: a skipped test passes, and would read SURVIVED.
//
// Usage: node scripts/mutate.ts <mutations.ts> [name-substring]
// Exits with the number of mutations that were not KILLED.
//
// With `--against <command…>` last, each mutant runs that command, whole,
// instead of its own and reports which checks fail: CAUGHT with their lines, or MISSED.
// No result, and the exit status is 0. It finds where a suite mutation's bug
// is already caught by a faster command, as a unit test.

import { execFileSync, spawn } from "node:child_process"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import {
  type RequirementPlace,
  requirementWords,
  testPlace,
  testRequirements,
  type UnitRequirement,
} from "../apps/pinetrie/e2e/requirements.ts"
import type { TestLane } from "../apps/pinetrie/scripts/test-lane.ts"
import type { ListedTest } from "./proofs.ts"
import { reportedTests } from "./requirements-report.ts"

interface MutationBase {
  /** What the mutant breaks, in words. */
  readonly name: string
  /** Repository-relative file to mutate. */
  readonly file: string
  /** Exact text to replace; must occur once. */
  readonly from: string
  readonly to: string
  /** Default 900 s. A run that exceeds it counts as KILLED (hung). */
  readonly timeoutMs?: number
}

/** A mutation a command catches: a unit test's, usually. */
export interface CommandMutation extends MutationBase {
  /** The command whose failure kills the mutant, e.g. ["pnpm", "exec", "vitest", "run", "packages/core"]. */
  readonly command: readonly string[]
  /** A fragment of the failing check's line that must appear in the output. */
  readonly expect?: string
}

/** The end-to-end suites, each a directory of scenarios. */
export type Suite = "host" | "live" | "browser" | "lanes" | "observer"

/** A mutation one scenario of a suite catches, at one check. */
export interface SuiteMutation extends MutationBase {
  readonly suite: Suite
  /** A scenario's file stem in the suite's directory (`SUITES`). */
  readonly scenario: string
  /** A check label in that scenario, exactly (`scripts/proofs.ts`). */
  readonly expect: string
}

export type Mutation = CommandMutation | SuiteMutation

/** Each suite's command, and the directory of its scenarios. */
export const SUITES: Readonly<
  Record<Suite, { readonly command: readonly string[]; readonly dir: string }>
> = {
  host: { command: ["pnpm", "run", "e2e"], dir: "apps/pinetrie/e2e/host" },
  live: { command: ["pnpm", "run", "e2e:live"], dir: "apps/pinetrie/e2e/host" },
  browser: {
    command: ["pnpm", "run", "e2e:browser"],
    dir: "apps/pinetrie/e2e/browser",
  },
  lanes: {
    command: ["pnpm", "run", "e2e:lanes"],
    dir: "apps/pinetrie/e2e/lanes",
  },
  observer: {
    command: ["pnpm", "run", "e2e:observer"],
    dir: "apps/pinetrie/e2e/observer",
  },
}

/** The command a mutation names: its own, or its suite's. */
export const mutationCommand = (m: Mutation): readonly string[] =>
  "suite" in m ? SUITES[m.suite].command : m.command

const VITEST_RUN = ["pnpm", "exec", "vitest", "run"] as const

/**
 * The paths a `pnpm exec vitest run <paths…>` command runs (none: every
 * file), or null for any other command, flags included: a command that
 * carries its own flags was narrowed by hand.
 */
const vitestRunPaths = (
  command: readonly string[],
): readonly string[] | null => {
  const paths = command.slice(VITEST_RUN.length)
  return VITEST_RUN.every((word, i) => command[i] === word) &&
    !paths.some(p => p.startsWith("-"))
    ? paths
    : null
}

/** `text` as a regular expression that matches it literally, as `-t` reads one. */
const literalPattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

/**
 * The command a unit mutant runs: only the files holding a test whose name
 * contains `expect`, and only those tests (`-t` matches a test's
 * `describe > … > title`, never its file). A kill already needs that test to
 * fail, so the other tests could only turn ELSEWHERE into SURVIVED. Any
 * other command, or an `expect` no listed test's name holds, is returned as
 * it is: a filter that matched nothing would run nothing, and pass.
 */
export function narrowedCommand(
  command: readonly string[],
  expect: string | undefined,
  tests: readonly ListedTest[],
): readonly string[] {
  const paths = vitestRunPaths(command)
  if (expect === undefined || paths === null) return command
  const files = [
    ...new Set(
      tests
        .filter(
          t =>
            (paths.length === 0 || paths.some(p => t.file.includes(p))) &&
            t.name.includes(expect),
        )
        .map(t => t.file),
    ),
  ].sort()
  if (files.length === 0) return command
  // One argument: an `expect` starting with "-" must not read as a flag.
  return [
    ...VITEST_RUN,
    ...files,
    `--testNamePattern=${literalPattern(expect)}`,
  ]
}

/**
 * What one `vitest list` must collect for `mutations` to be narrowed: the
 * paths their commands run, `[]` for every file, or null when none can be.
 */
export function testsToList(
  mutations: readonly Mutation[],
): readonly string[] | null {
  const each = mutations.flatMap(m =>
    "suite" in m || m.expect === undefined
      ? []
      : [vitestRunPaths(m.command)].filter(p => p !== null),
  )
  if (each.length === 0) return null
  if (each.some(paths => paths.length === 0)) return []
  return [...new Set(each.flat())].sort()
}

/** How a unit mutation's command ran with nothing mutated. */
export type Baseline =
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly failing: readonly string[] }
  /** Every test it ran skipped: what they require of the place, by their tags. */
  | {
      readonly kind: "skipped"
      readonly requirements: readonly UnitRequirement[]
    }

export type MutantStep =
  | { readonly kind: "run"; readonly command: readonly string[] }
  | { readonly kind: "baseline"; readonly failing: readonly string[] }
  | {
      readonly kind: "not-here"
      readonly requirements: readonly UnitRequirement[]
    }

/**
 * What a mutant does, given how its command ran with nothing mutated. A
 * command that fails unmutated would read KILLED with no bug, as a test
 * that passes only after another in its file does once narrowed to it; one
 * whose tests all skipped would read SURVIVED, its tests never run.
 */
export const planMutant = (
  command: readonly string[],
  baseline: Baseline,
): MutantStep => {
  switch (baseline.kind) {
    case "passed":
      return { kind: "run", command }
    case "failed":
      return { kind: "baseline", failing: baseline.failing }
    case "skipped":
      return { kind: "not-here", requirements: baseline.requirements }
  }
}

/**
 * Whether a baseline's narrowed tests all skipped, from Vitest's JSON
 * report: those whose name holds `expect`. Their requirements are the
 * union of their tags'; null when one ran, or none was reported.
 */
export function skippedRequirements(
  report: unknown,
  root: string,
  expect: string,
): readonly UnitRequirement[] | null {
  const tests = reportedTests(report, root).filter(t => t.name.includes(expect))
  if (tests.length === 0 || tests.some(t => t.status !== "skipped")) return null
  return [...new Set(tests.flatMap(t => testRequirements(t.tags)))]
}

/**
 * Where a mutant whose tests skip here runs: in a lane, when the place
 * plans its requirements there; else nowhere, with why.
 */
export function notHerePlace(
  requirements: readonly UnitRequirement[],
  plan: Readonly<Record<UnitRequirement, RequirementPlace>>,
):
  | { readonly kind: "lane" }
  | { readonly kind: "nowhere"; readonly why: string } {
  const place = testPlace(requirements, plan)
  if (place.kind === "lane") return { kind: "lane" }
  if (place.kind === "unmet") {
    const p = plan[place.requirement]
    return {
      kind: "nowhere",
      why:
        p.kind === "unmet"
          ? p.why
          : `needs ${requirementWords(place.requirement)}`,
    }
  }
  return {
    kind: "nowhere",
    why: "its tests skip here, though this place meets what they require",
  }
}

export type MutantResult =
  | "killed"
  | "survived"
  | "broken"
  | "elsewhere"
  | "anchor"
  | "baseline"
  | "not-here"

/** A result as the run prints it: in capitals, so it stands out in a log. */
export const resultWord = (result: MutantResult): string => result.toUpperCase()

/** Signs that the mutant never ran: the change itself does not load. */
const LOAD_FAILURES = [
  "SyntaxError",
  "Failed to load",
  "Transform failed",
  "ERR_INVALID_TYPESCRIPT_SYNTAX",
  "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
]

/**
 * Judge one run. Pure, so the rules above are testable without running
 * anything.
 */
export function judge(
  run: {
    readonly status: number | null
    readonly timedOut: boolean
    readonly output: string
  },
  expect: string | undefined,
): MutantResult {
  if (run.timedOut) return "killed"
  if (LOAD_FAILURES.some(sign => run.output.includes(sign))) return "broken"
  if (run.status === 0) return "survived"
  if (expect === undefined) return "killed"
  return failingChecks(run.output).some(line => line.includes(expect))
    ? "killed"
    : "elsewhere"
}

/** A terminal colour code. Vitest colours its marks even into a pipe. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/**
 * The lines of a run's output that name a failing check: a suite's `FAIL`,
 * Vitest's `×`, or an assertion's error.
 */
export const failingChecks = (output: string): string[] =>
  output
    .replace(COLOUR, "")
    .split("\n")
    .filter(
      line => /^\s*(FAIL|×)/.test(line) || line.includes("AssertionError"),
    )

/**
 * The environment a mutant runs in: the parent's, the check to stop at, and,
 * for a suite mutation, the one scenario to run.
 */
export function mutantEnv(
  base: NodeJS.ProcessEnv,
  m: Pick<Mutation, "expect"> & { readonly scenario?: string },
): NodeJS.ProcessEnv {
  if (m.expect === undefined && m.scenario === undefined) return base
  return {
    ...base,
    ...(m.expect === undefined ? {} : { PINETRIE_STOP_AT: m.expect }),
    ...(m.scenario === undefined ? {} : { PINETRIE_SCENARIO: m.scenario }),
  }
}

/**
 * Run `cmd` in its own process group, and on timeout kill the whole group. A
 * timeout that killed only the direct child (`pnpm`) left its workers running:
 * a mutant that loops forever, as one is meant to, then spun at full CPU for
 * hours after the harness had moved on.
 */
export function run(
  cmd: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number | null; timedOut: boolean; output: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, detached: true, env })
    let output = ""
    child.stdout.on("data", d => {
      output += d
    })
    child.stderr.on("data", d => {
      output += d
    })
    let timedOut = false
    const killGroup = () => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {}
    }
    const timer = setTimeout(() => {
      timedOut = true
      killGroup()
    }, timeoutMs)
    child.on("close", status => {
      clearTimeout(timer)
      // The run is over: nothing it started may outlive it.
      killGroup()
      resolve({ status, timedOut, output })
    })
  })
}

/** Whether `from` occurs exactly once in `source`, as a mutation's anchor must. */
const isAnchored = (source: string, from: string): boolean =>
  source.split(from).length === 2

/**
 * Run `body` with the mutant in place, and restore the file however it ends.
 * An anchor that does not occur exactly once runs nothing.
 */
async function withMutant<T>(
  root: string,
  m: Mutation,
  body: () => Promise<T>,
): Promise<T | "anchor"> {
  const file = path.join(root, m.file)
  const original = readFileSync(file, "utf8")
  if (!isAnchored(original, m.from)) return "anchor"
  const restore = () => writeFileSync(file, original)
  process.once("SIGINT", restore)
  writeFileSync(file, original.replace(m.from, m.to))
  try {
    return await body()
  } finally {
    restore()
    process.removeListener("SIGINT", restore)
  }
}

/**
 * The mutations a filter names, or why there are none: a filter that matches
 * nothing is a mistake, and a run of nothing would read as a pass.
 */
export function choose(
  mutations: readonly Mutation[],
  only: string | undefined,
): readonly Mutation[] | string {
  const chosen = mutations.filter(
    m => only === undefined || m.name.includes(only),
  )
  if (chosen.length > 0) return chosen
  return only === undefined
    ? "the list has no mutations"
    : `no mutation's name contains "${only}"`
}

/** Every mutation list in `dir` (`scripts/mutations`), by file name, in name order. */
export async function loadMutationLists(
  dir: string,
): Promise<
  readonly { readonly file: string; readonly mutations: readonly Mutation[] }[]
> {
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".ts"))
    .sort()
  return Promise.all(
    files.map(async file => ({
      file,
      mutations: (
        (await import(pathToFileURL(path.join(dir, file)).href)) as {
          mutations: readonly Mutation[]
        }
      ).mutations,
    })),
  )
}

/** The lines of `output` that name a failing check, each once, trimmed. */
const failingOnce = (output: string): readonly string[] => [
  ...new Set(failingChecks(output).map(l => l.trim())),
]

/**
 * Every test that `vitest list` collects under `paths` (none: every file),
 * by file from `root` and full name, those this place cannot run among them. `--staticParse=false` runs each file to
 * collect it: a static parse, Vitest's default from 5, lists a `test.each`
 * by its template ("%s"), not its cases.
 */
export function listTests(
  root: string,
  paths: readonly string[],
): readonly ListedTest[] {
  const listed = JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "vitest", "list", "--json", "--staticParse=false", ...paths],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 64 * 1024 * 1024,
        // Every test, whatever this place meets: a mutation names its test
        // wherever it runs (`vitest.config.mjs`).
        env: { ...process.env, PINETRIE_EVERY_TAG: "1" },
      },
    ),
  ) as readonly { readonly file: string; readonly name: string }[]
  return listed.map(t => ({ file: path.relative(root, t.file), name: t.name }))
}

/**
 * How `command` runs with nothing mutated: run once per batch, however many
 * mutants share it (`known`). A Vitest run narrowed to `expect` also writes
 * its JSON report, which says whether its tests ran or all skipped here.
 */
const baselineWithout = (
  root: string,
  command: readonly string[],
  expect: string | undefined,
  timeoutMs: number,
  known: Map<string, Promise<Baseline>>,
): Promise<Baseline> => {
  const key = JSON.stringify(command)
  const seen = known.get(key)
  if (seen !== undefined) return seen
  const reportDir =
    expect !== undefined && VITEST_RUN.every((w, i) => command[i] === w)
      ? mkdtempSync(path.join(tmpdir(), "pinetrie-mutate-"))
      : null
  const report = reportDir === null ? null : path.join(reportDir, "report.json")
  const [cmd, ...args] =
    report === null
      ? command
      : [
          ...command,
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${report}`,
        ]
  const result: Promise<Baseline> =
    cmd === undefined
      ? Promise.resolve({ kind: "failed", failing: [] })
      : run(cmd, args, root, timeoutMs).then(r => {
          let json: unknown = null
          if (report !== null)
            try {
              json = JSON.parse(readFileSync(report, "utf8"))
            } catch {
              // No report to read: the run's status is all there is.
            }
          if (reportDir !== null)
            rmSync(reportDir, { recursive: true, force: true })
          if (r.status !== 0 || r.timedOut)
            return { kind: "failed", failing: failingOnce(r.output) }
          if (expect === undefined) return { kind: "passed" }
          const skipped = skippedRequirements(json, root, expect)
          return skipped === null
            ? { kind: "passed" }
            : { kind: "skipped", requirements: skipped }
        })
  known.set(key, result)
  return result
}

/**
 * Where a mutant whose tests skip here can run, asked once per call: the
 * place's plan, read only when a mutant needs it, and the lane, made only
 * when one runs there.
 */
export interface Elsewhere {
  place(
    requirements: readonly UnitRequirement[],
  ): Promise<
    | { readonly kind: "lane" }
    | { readonly kind: "nowhere"; readonly why: string }
  >
  lane(): Promise<TestLane>
  /** Remove the lane, when one was made. */
  close(): Promise<void>
}

/**
 * A mutant's result, the command it ran, and the checks that failed: with
 * it in place, or, for BASELINE, without it. A unit mutant's command runs
 * once unmutated first, and a suite's does not: a scenario's run is minutes.
 * One whose tests all skip here runs in the lane, baseline and mutant alike.
 */
async function apply(
  root: string,
  m: Mutation,
  tests: readonly ListedTest[],
  known: Map<string, Promise<Baseline>>,
  elsewhere: Elsewhere,
): Promise<{
  readonly result: MutantResult
  readonly command: readonly string[]
  readonly failing: readonly string[]
}> {
  const timeoutMs = m.timeoutMs ?? 900_000
  const command =
    "suite" in m
      ? mutationCommand(m)
      : narrowedCommand(m.command, m.expect, tests)
  // Before the baseline: a drifted anchor runs nothing at all.
  if (!isAnchored(readFileSync(path.join(root, m.file), "utf8"), m.from))
    return { result: "anchor", command, failing: [] }
  const step = planMutant(
    command,
    "suite" in m
      ? { kind: "passed" }
      : await baselineWithout(root, command, m.expect, timeoutMs, known),
  )
  if (step.kind === "baseline")
    return { result: "baseline", command, failing: step.failing }
  if (step.kind === "not-here") {
    const place = await elsewhere.place(step.requirements)
    if (place.kind === "nowhere")
      return { result: "not-here", command, failing: [place.why] }
    return inLane(root, m, command, await elsewhere.lane(), timeoutMs)
  }
  const ran = await withMutant(root, m, async () => {
    const [cmd, ...args] = step.command
    if (cmd === undefined) return { result: "broken" as const, failing: [] }
    const r = await run(cmd, args, root, timeoutMs, mutantEnv(process.env, m))
    return { result: judge(r, m.expect), failing: failingOnce(r.output) }
  })
  return ran === "anchor"
    ? { result: ran, command, failing: [] }
    : { ...ran, command }
}

/**
 * A unit mutant run in the lane: its command once unmutated there, then
 * with the mutant's file sent in, and the original sent back however it
 * ends.
 */
async function inLane(
  root: string,
  m: Mutation,
  command: readonly string[],
  lane: TestLane,
  timeoutMs: number,
): Promise<{
  readonly result: MutantResult
  readonly command: readonly string[]
  readonly failing: readonly string[]
}> {
  const base = await lane.run(command, { timeoutMs })
  if (base.status !== 0)
    return { result: "baseline", command, failing: failingOnce(base.output) }
  try {
    const ran = await withMutant(root, m, async () => {
      await lane.put([m.file])
      const r = await lane.run(command, { timeoutMs })
      return {
        result: judge(
          { status: r.status, timedOut: r.status === null, output: r.output },
          m.expect,
        ),
        failing: failingOnce(r.output),
      }
    })
    return ran === "anchor"
      ? { result: ran, command, failing: [] }
      : { ...ran, command }
  } finally {
    await lane.put([m.file])
  }
}

/** The checks `against` fails with the mutant in place, each once, trimmed. */
const probe = (
  root: string,
  m: Mutation,
  against: readonly string[],
): Promise<readonly string[] | "anchor"> =>
  withMutant(root, m, async () => {
    const [cmd, ...args] = against
    if (cmd === undefined) return []
    const { output } = await run(cmd, args, root, m.timeoutMs ?? 900_000)
    return failingOnce(output)
  })

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2)
  const at = argv.indexOf("--against")
  const [list, only] = at < 0 ? argv : argv.slice(0, at)
  const against = at < 0 ? undefined : argv.slice(at + 1)
  if (list === undefined || against?.length === 0) {
    console.error(
      "usage: node scripts/mutate.ts <mutations.ts> [name-substring] [--against <command…>]",
    )
    process.exit(2)
  }
  const root = path.resolve(import.meta.dirname, "..")
  const mod = (await import(pathToFileURL(path.resolve(list)).href)) as {
    mutations: readonly Mutation[]
  }
  const chosen = choose(mod.mutations, only)
  if (typeof chosen === "string") {
    console.error(chosen)
    process.exit(2)
  }
  if (against !== undefined) {
    for (const m of chosen) {
      const failing = await probe(root, m, against)
      if (failing === "anchor")
        console.log(`  ${resultWord(failing).padEnd(9)} ${m.name}`)
      else if (failing.length === 0) console.log(`  MISSED    ${m.name}`)
      else
        console.log(
          `  CAUGHT    ${m.name}\n${failing.map(l => `      ${l}`).join("\n")}`,
        )
    }
    process.exit(0)
  }
  const listing = testsToList(chosen)
  const tests = listing === null ? [] : listTests(root, listing)
  const known = new Map<string, Promise<Baseline>>()
  let plan: Promise<
    Readonly<Record<UnitRequirement, RequirementPlace>>
  > | null = null
  let lane: Promise<TestLane> | null = null
  const elsewhere: Elsewhere = {
    async place(requirements) {
      plan ??= (async () => {
        const { gatherUnitFacts } = await import(
          "../apps/pinetrie/e2e/place.ts"
        )
        const { planUnitRequirements } = await import(
          "../apps/pinetrie/e2e/requirements.ts"
        )
        const { runtimeProblem } = await import(
          "../apps/pinetrie/e2e/lane-hosts.ts"
        )
        return planUnitRequirements({
          ...gatherUnitFacts(root),
          laneRuntime: await runtimeProblem(),
        })
      })()
      return notHerePlace(requirements, await plan)
    },
    lane() {
      lane ??= import("../apps/pinetrie/scripts/test-lane.ts").then(m =>
        m.openTestLane({ root, log: l => console.log(`      ${l}`) }),
      )
      return lane
    },
    async close() {
      if (lane !== null) await (await lane).close()
    },
  }
  let bad = 0
  for (const m of chosen) {
    const { result, command, failing } = await apply(
      root,
      m,
      tests,
      known,
      elsewhere,
    )
    console.log(`  ${resultWord(result).padEnd(9)} ${m.name}`)
    if (result !== "killed" && result !== "anchor")
      console.log(`      ran: ${command.join(" ")}`)
    // ELSEWHERE: caught by another check, so the expect has drifted from the
    // test that catches it, which is one of these. BASELINE: what fails with
    // nothing mutated. NOT-HERE: why no place can run its tests.
    if (
      result === "elsewhere" ||
      result === "baseline" ||
      result === "not-here"
    )
      for (const line of failing.slice(0, 5)) console.log(`      ${line}`)
    if (result !== "killed") bad += 1
  }
  await elsewhere.close()
  console.log(`\n=== mutations: ${chosen.length - bad} killed, ${bad} not ===`)
  process.exit(bad)
}
