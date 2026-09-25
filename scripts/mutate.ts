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
//
// Usage: node scripts/mutate.ts <mutations.ts> [name-substring]
// Exits with the number of mutations that were not KILLED.

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

export interface Mutation {
  /** What the mutant breaks, in words. */
  readonly name: string
  /** Repository-relative file to mutate. */
  readonly file: string
  /** Exact text to replace; must occur once. */
  readonly from: string
  readonly to: string
  /** The command whose failure kills the mutant, e.g. ["pnpm", "exec", "vitest", "run", "packages/core"]. */
  readonly command: readonly string[]
  /** A fragment of the failing check's line that must appear in the output. */
  readonly expect?: string
  /** Default 900 s. A run that exceeds it counts as KILLED (hung). */
  readonly timeoutMs?: number
}

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
  const failing = run.output
    .split("\n")
    .filter(
      line => /^\s*(FAIL|×)/.test(line) || line.includes("AssertionError"),
    )
  return failing.some(line => line.includes(expect)) ? "KILLED" : "ELSEWHERE"
}

function apply(root: string, m: Mutation): Verdict {
  const file = path.join(root, m.file)
  const original = readFileSync(file, "utf8")
  if (original.split(m.from).length !== 2) return "ANCHOR"
  const restore = () => writeFileSync(file, original)
  process.once("SIGINT", restore)
  writeFileSync(file, original.replace(m.from, m.to))
  try {
    const [cmd, ...args] = m.command
    if (cmd === undefined) return "BROKEN"
    const run = spawnSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      timeout: m.timeoutMs ?? 900_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    const timedOut =
      run.error !== undefined &&
      "code" in run.error &&
      run.error.code === "ETIMEDOUT"
    return judge(
      {
        status: run.status,
        timedOut,
        output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
      },
      m.expect,
    )
  } finally {
    restore()
    process.removeListener("SIGINT", restore)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [list, only] = process.argv.slice(2)
  if (list === undefined) {
    console.error(
      "usage: node scripts/mutate.ts <mutations.ts> [name-substring]",
    )
    process.exit(2)
  }
  const root = path.resolve(import.meta.dirname, "..")
  const mod = (await import(pathToFileURL(path.resolve(list)).href)) as {
    mutations: readonly Mutation[]
  }
  const chosen = mod.mutations.filter(
    m => only === undefined || m.name.includes(only),
  )
  let bad = 0
  for (const m of chosen) {
    const verdict = apply(root, m)
    console.log(`  ${verdict.padEnd(9)} ${m.name}`)
    if (verdict !== "KILLED") bad += 1
  }
  console.log(`\n=== mutations: ${chosen.length - bad} killed, ${bad} not ===`)
  process.exit(bad)
}
