// scripts/proofs — "a check without a proof it can fail is not yet a check",
// as a rule between the checks and their mutations. Pure: the labels, tests
// and mutations come in, and what breaks the rule comes out.
//
// Every check label in a scenario (`apps/pinetrie/e2e/<suite>/<name>.scenario.ts`)
// is the `expect` of a suite mutation that names that scenario, and every
// suite mutation's `expect` is a label in the scenario it names. A unit
// mutation's `expect` is in the full name of a test its command runs: a test
// renamed or deleted leaves it naming nothing, and its kill reads ELSEWHERE.

import type { Mutation, SuiteMutation } from "./mutate.ts"

/** A scenario, as `<suite directory>/<file stem>`: `host/send`. */
export type ScenarioKey = string

export interface ProofGaps {
  /** Labels no suite mutation expects. */
  readonly unproven: readonly {
    readonly scenario: ScenarioKey
    readonly label: string
  }[]
  /** Suite mutations whose scenario does not exist, or whose `expect` is no label in it. */
  readonly unknown: readonly {
    readonly mutation: string
    readonly why: string
  }[]
  /** Labels that occur twice in one scenario. */
  readonly duplicates: readonly {
    readonly scenario: ScenarioKey
    readonly label: string
  }[]
  /** Files other than scenarios that call `check(`. */
  readonly stray: readonly string[]
}

/** The scenario a suite mutation names, as a key. */
export const scenarioKey = (
  dirOf: (m: SuiteMutation) => string,
  m: SuiteMutation,
): ScenarioKey => `${dirOf(m)}/${m.scenario}`

export function proofGaps(input: {
  readonly labels: ReadonlyMap<ScenarioKey, readonly string[]>
  readonly mutations: readonly Mutation[]
  /** The suite directory each suite's scenarios are in: `host`, `browser`. */
  readonly dirOf: (m: SuiteMutation) => string
  readonly checkCallers: readonly string[]
}): ProofGaps {
  const suite = input.mutations.filter((m): m is SuiteMutation => "suite" in m)
  const expected = new Set(
    suite.map(m => `${scenarioKey(input.dirOf, m)}\n${m.expect}`),
  )
  const unproven = [...input.labels].flatMap(([scenario, labels]) =>
    [...new Set(labels)]
      .filter(label => !expected.has(`${scenario}\n${label}`))
      .map(label => ({ scenario, label })),
  )
  const unknown = suite.flatMap(m => {
    const labels = input.labels.get(scenarioKey(input.dirOf, m))
    if (labels === undefined)
      return [{ mutation: m.name, why: `no scenario ${m.scenario}` }]
    return labels.includes(m.expect)
      ? []
      : [{ mutation: m.name, why: `no check "${m.expect}" in ${m.scenario}` }]
  })
  const duplicates = [...input.labels].flatMap(([scenario, labels]) =>
    labels
      .filter((l, i) => labels.indexOf(l) !== i)
      .map(label => ({ scenario, label })),
  )
  return { unproven, unknown, duplicates, stray: [...input.checkCallers] }
}

/** A `check(` whose first argument is a string literal, in either quote style. */
const LABEL = /(?<![\w.])check\(\s*(["'])((?:\\.|(?!\1).)*)\1/g
/** Any `check(` call. */
const CALL = /(?<![\w.])check\(/g

/**
 * Every literal `check(` label in a scenario's source, and how many `check(`
 * calls have a first argument that is not a literal.
 */
export function labelsIn(source: string): {
  readonly labels: readonly string[]
  readonly nonLiteral: number
} {
  const labels = [...source.matchAll(LABEL)].map(m =>
    (m[2] ?? "").replace(/\\(.)/g, "$1"),
  )
  const calls = (source.match(CALL) ?? []).length
  return { labels, nonLiteral: calls - labels.length }
}

/** Whether a source calls `check(`, as only a scenario may. */
export const callsCheck = (source: string): boolean =>
  (source.match(CALL) ?? []).length > 0

/** A test as Vitest lists it: its file from the repository's root, and its full name (`describe > … > title`). */
export interface ListedTest {
  readonly file: string
  readonly name: string
}

/**
 * The file filters a Vitest command runs, as Vitest reads them: each a part
 * of a test file's path, none for every file. Null for a command that is not
 * `vitest run`.
 */
export function vitestFilters(
  command: readonly string[],
): readonly string[] | null {
  const run = command.indexOf("run")
  if (!command.includes("vitest") || run < 0) return null
  return command.slice(run + 1).filter(arg => !arg.startsWith("-"))
}

/**
 * Unit mutations whose `expect` is in the full name of no test their
 * command runs. A failing test prints as `file > describe > title`, and
 * `pnpm mutate` looks for the `expect` there.
 */
export function unitExpectGaps(
  mutations: readonly Mutation[],
  tests: readonly ListedTest[],
): readonly { readonly mutation: string; readonly why: string }[] {
  return mutations.flatMap(m => {
    if ("suite" in m || m.expect === undefined) return []
    const filters = vitestFilters(m.command)
    if (filters === null) return []
    const expect = m.expect
    const named = tests.some(
      t =>
        (filters.length === 0 || filters.some(f => t.file.includes(f))) &&
        `${t.file} > ${t.name}`.includes(expect),
    )
    return named
      ? []
      : [
          {
            mutation: m.name,
            why: `no test its command runs (${filters.join(" ") || "every test"}) is named "${expect}"`,
          },
        ]
  })
}
