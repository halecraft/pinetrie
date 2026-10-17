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
//     `apps/pinetrie/e2e/checks.ts`): nothing after it changes the verdict.
//   - A suite mutation runs only its scenario (`PINETRIE_SCENARIO`,
//     `apps/pinetrie/e2e/scenario.ts`), with its suite's command (`SUITES`).
//
// Usage: node scripts/mutate.ts <mutations.ts> [name-substring]
// Exits with the number of mutations that were not KILLED.
//
// With `--against <command…>` last, each mutant runs that command instead of
// its own and reports which checks fail: CAUGHT with their lines, or MISSED.
// No verdict, and the exit status is 0. It finds where a suite mutation's bug
// is already caught by a faster command, as a unit test.

import { spawn } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

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

/** The command a mutation runs. */
export const commandOf = (m: Mutation): readonly string[] =>
  "suite" in m ? SUITES[m.suite].command : m.command

export type Verdict = "KILLED" | "SURVIVED" | "BROKEN" | "ELSEWHERE" | "ANCHOR"

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
): Verdict {
  if (run.timedOut) return "KILLED"
  if (LOAD_FAILURES.some(sign => run.output.includes(sign))) return "BROKEN"
  if (run.status === 0) return "SURVIVED"
  if (expect === undefined) return "KILLED"
  return failingChecks(run.output).some(line => line.includes(expect))
    ? "KILLED"
    : "ELSEWHERE"
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

/**
 * Run `body` with the mutant in place, and restore the file however it ends.
 * An anchor that does not occur exactly once runs nothing.
 */
async function withMutant<T>(
  root: string,
  m: Mutation,
  body: () => Promise<T>,
): Promise<T | "ANCHOR"> {
  const file = path.join(root, m.file)
  const original = readFileSync(file, "utf8")
  if (original.split(m.from).length !== 2) return "ANCHOR"
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

/** A mutant's verdict, and the checks that failed with it in place. */
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

const apply = (
  root: string,
  m: Mutation,
): Promise<{
  readonly verdict: Verdict
  readonly failing: readonly string[]
}> =>
  withMutant(root, m, async () => {
    const [cmd, ...args] = commandOf(m)
    if (cmd === undefined) return { verdict: "BROKEN" as const, failing: [] }
    const ran = await run(
      cmd,
      args,
      root,
      m.timeoutMs ?? 900_000,
      mutantEnv(process.env, m),
    )
    return {
      verdict: judge(ran, m.expect),
      failing: [...new Set(failingChecks(ran.output).map(l => l.trim()))],
    }
  }).then(r => (r === "ANCHOR" ? { verdict: r, failing: [] } : r))

/** The checks `against` fails with the mutant in place, each once, trimmed. */
const probe = (
  root: string,
  m: Mutation,
  against: readonly string[],
): Promise<readonly string[] | "ANCHOR"> =>
  withMutant(root, m, async () => {
    const [cmd, ...args] = against
    if (cmd === undefined) return []
    const { output } = await run(cmd, args, root, m.timeoutMs ?? 900_000)
    return [...new Set(failingChecks(output).map(line => line.trim()))]
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
      if (failing === "ANCHOR") console.log(`  ANCHOR    ${m.name}`)
      else if (failing.length === 0) console.log(`  MISSED    ${m.name}`)
      else
        console.log(
          `  CAUGHT    ${m.name}\n${failing.map(l => `      ${l}`).join("\n")}`,
        )
    }
    process.exit(0)
  }
  let bad = 0
  for (const m of chosen) {
    const { verdict, failing } = await apply(root, m)
    console.log(`  ${verdict.padEnd(9)} ${m.name}`)
    // Caught by another check: the expect has drifted from the test that
    // catches it, which is one of these.
    if (verdict === "ELSEWHERE")
      for (const line of failing.slice(0, 5)) console.log(`      ${line}`)
    if (verdict !== "KILLED") bad += 1
  }
  console.log(`\n=== mutations: ${chosen.length - bad} killed, ${bad} not ===`)
  process.exit(bad)
}
