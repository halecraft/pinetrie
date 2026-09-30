// Mutations for the root's own tools. Run: pnpm mutate scripts/mutations/scripts.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "scripts/mutate.test.ts"]
const checks = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "apps/pineta/e2e/checks.test.ts",
]

export const mutations: readonly Mutation[] = [
  {
    name: "a timeout kills only the direct child",
    file: "scripts/mutate.ts",
    from: '        process.kill(-child.pid, "SIGKILL")',
    to: '        process.kill(child.pid, "SIGKILL")',
    command: unit,
    expect: "grandchildren too",
  },
  {
    name: "every failing check stops the suite",
    file: "apps/pineta/e2e/checks.ts",
    from: '  !passed && stopAt !== undefined && stopAt !== "" && label.includes(stopAt)',
    to: '  !passed && stopAt !== undefined && stopAt !== ""',
    command: checks,
    expect: "a failing check whose label names stopAt stops",
  },
  {
    name: "a stop is not recorded as a failure",
    file: "apps/pineta/e2e/checks.ts",
    from: "      ;(pass ? passed : failed).push(label)",
    to: "      if (!stopsHere(pass, label, stopAt)) (pass ? passed : failed).push(label)",
    command: checks,
    expect: "ok throws at the named failing check, after recording it",
  },
  {
    name: "mutate names no check",
    file: "scripts/mutate.ts",
    from: "  return expect === undefined ? base : { ...base, PINETA_STOP_AT: expect }",
    to: "  return base",
    command: unit,
    expect: "with an expectation, PINETA_STOP_AT is set",
  },
  {
    name: "a stop reads as a load failure",
    file: "scripts/mutate.ts",
    from: '  "SyntaxError",',
    to: '  "SyntaxError",\n  "stopped at the check",',
    command: unit,
    expect: "a suite stopped at the expected check is KILLED by it",
  },
  {
    name: "failingChecks misses Vitest's failures",
    file: "scripts/mutate.ts",
    from: '      line => /^\\s*(FAIL|×)/.test(line) || line.includes("AssertionError"),',
    to: '      line => /^\\s*FAIL/.test(line) || line.includes("AssertionError"),',
    command: unit,
    expect: "a suite's FAIL, Vitest's ×, and an assertion error",
  },
  {
    name: "a filter that names nothing runs nothing, and passes",
    file: "scripts/mutate.ts",
    from: "  if (chosen.length > 0) return chosen",
    to: "  if (chosen.length >= 0) return chosen",
    command: unit,
    expect: "a filter that names nothing is refused",
  },
]
