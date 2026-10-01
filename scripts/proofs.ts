// scripts/proofs — "a check without a proof it can fail is not yet a check",
// as a rule between the suites' checks and their mutations. Pure: the
// labels and mutations come in, and what breaks the rule comes out.
//
// Every check label in a scenario (`apps/pineta/e2e/<suite>/<name>.scenario.ts`)
// is the `expect` of a suite mutation that names that scenario, and every
// suite mutation's `expect` is a label in the scenario it names.

import type { Mutation, SuiteMutation } from "./mutate.ts"

/** A scenario, as `<suite directory>/<file stem>`: `host/chat`. */
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
