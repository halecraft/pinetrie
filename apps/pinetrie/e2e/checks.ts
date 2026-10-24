// e2e/checks — how the end-to-end suites record a check, and when a suite
// stops at one.
//
// Every scenario records its checks here, so they read and exit alike. It
// imports only the requirements' values, so its test loads at once.

import { requirementWords, type SuiteRequirement } from "./requirements.ts"

/**
 * Why a check or a scenario did not run: a requirement of the place this one
 * does not meet, with what it lacks if known; or what no spike has measured
 * yet, which no place meets.
 */
export type SkipWhy =
  | { readonly requirement: SuiteRequirement; readonly why?: string }
  | { readonly unmeasured: string }

export interface Checks {
  /**
   * Record an assertion. Truthy passes. `label` is a string literal, which a
   * mutation's `expect` names exactly (`scripts/proofs.ts`); what a run found
   * goes in `detail`, printed after it. A failing check whose label is
   * `PINETRIE_STOP_AT` ends the suite (`stopsHere`).
   */
  check(label: string, condition: unknown, detail?: string): void
  /** A check that could not run here, and why: neither a pass nor a fail. */
  skip(label: string, why: SkipWhy): void
  /** A scenario that threw: a failure under the scenario's name. */
  error(scenario: string, message: string): void
  /**
   * Print the tally and the marked line, with `children`'s counts added (a
   * suite's scenarios run as processes), and exit non-zero if anything
   * failed. Never returns.
   */
  report(title: string, children?: SuiteCounts): never
  readonly passed: readonly string[]
  readonly failed: readonly string[]
  readonly skipped: readonly string[]
}

/**
 * Whether a check's result ends the suite: it failed, and its label is
 * `stopAt`. `judge` in `scripts/mutate.ts` counts a mutant KILLED when a
 * FAIL line holds its `expect`, and `mutate` passes `expect` as
 * `PINETRIE_STOP_AT`: nothing after that check can change the result.
 */
export const stopsHere = (
  passed: boolean,
  label: string,
  stopAt: string | undefined,
): boolean => !passed && stopAt !== undefined && label === stopAt

/** The message of the error `check()` throws to end the suite. */
export const stopMessage = (label: string): string =>
  `stopped at the check PINETRIE_STOP_AT names: ${label}`

/** Whether `error` is the stop `check()` threw, which ends the whole suite. */
export const isStop = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.startsWith("stopped at the check PINETRIE_STOP_AT names: ")

/** Why a check did not run, as its SKIP line says it. */
export function skipWords(why: SkipWhy): string {
  if ("unmeasured" in why) return why.unmeasured
  const needs = `needs ${requirementWords(why.requirement)}`
  return why.why === undefined ? needs : `${needs}: ${why.why}`
}

/** A run's checks counted, its skips by requirement (`unmeasured` for one no spike has measured). */
export interface SuiteCounts {
  readonly passed: number
  readonly failed: number
  readonly skipsBy: ReadonlyMap<string, number>
}

export const NO_COUNTS: SuiteCounts = {
  passed: 0,
  failed: 0,
  skipsBy: new Map(),
}

/** Each skip's group, counted, in the order each group first came. */
export function skipCounts(
  skips: readonly SkipWhy[],
): ReadonlyMap<string, number> {
  const by = new Map<string, number>()
  for (const s of skips) {
    const key = "unmeasured" in s ? "unmeasured" : s.requirement
    by.set(key, (by.get(key) ?? 0) + 1)
  }
  return by
}

export function sumSuiteCounts(a: SuiteCounts, b: SuiteCounts): SuiteCounts {
  const skipsBy = new Map(a.skipsBy)
  for (const [k, n] of b.skipsBy) skipsBy.set(k, (skipsBy.get(k) ?? 0) + n)
  return {
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    skipsBy,
  }
}

/** What starts the marked line; `verify`'s parser looks for it (`scripts/verify-parsers.ts`). */
export const SUITE_MARK = "suite: "

const skippedTotal = (c: SuiteCounts): number =>
  [...c.skipsBy.values()].reduce((sum, n) => sum + n, 0)

/**
 * The marked line a suite ends with, which `verify`'s `suite` parser reads
 * (`scripts/verify-parsers.ts`): its counts, and its skips by requirement.
 * A suite run as processes reads each one's back (`readSuiteCounts`), so
 * its words and that reader change together.
 */
export function suiteSummaryLine(counts: SuiteCounts): string {
  const skipped = skippedTotal(counts)
  const groups = [...counts.skipsBy].map(([k, n]) =>
    n === 1 ? k : `${k} ×${n}`,
  )
  return `${SUITE_MARK}${[
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
    `${counts.passed} passed`,
    ...(skipped > 0 ? [`${skipped} skipped (${groups.join(", ")})`] : []),
  ].join(" · ")}`
}

/**
 * The counts of the last marked line in `output` (`suiteSummaryLine`), or
 * null when it has none: a run that crashed before its report.
 */
export function readSuiteCounts(output: string): SuiteCounts | null {
  const last = output
    .split("\n")
    .filter(l => l.startsWith(SUITE_MARK))
    .at(-1)
  if (last === undefined) return null
  const m =
    /^(?:(\d+) failed · )?(\d+) passed(?: · \d+ skipped \((.*)\))?$/.exec(
      last.slice(SUITE_MARK.length),
    )
  if (m === null) return null
  const skipsBy = new Map<string, number>()
  for (const group of m[3]?.split(", ") ?? []) {
    const [key = "", times] = group.split(" ×")
    skipsBy.set(key, times === undefined ? 1 : Number(times))
  }
  return { passed: Number(m[2]), failed: Number(m[1] ?? 0), skipsBy }
}

/** A label and what was found, as one line prints them. */
export const line = (label: string, detail: string | undefined): string =>
  detail === undefined || detail === "" ? label : `${label} · ${detail}`

/**
 * `stopAt` defaults to `PINETRIE_STOP_AT`. A stop throws rather than exits, so
 * every `finally` on the way out runs: a scenario shuts its host down, and
 * `e2e:lanes` removes its containers and volumes.
 */
export function createChecks(
  stopAt: string | undefined = process.env.PINETRIE_STOP_AT,
  print: (line: string) => void = console.log,
): Checks {
  const passed: string[] = []
  const failed: string[] = []
  const skipped: string[] = []
  const skips: SkipWhy[] = []

  return {
    passed,
    failed,
    skipped,
    check(label, condition, detail) {
      const pass = Boolean(condition)
      ;(pass ? passed : failed).push(label)
      print(`  ${pass ? "PASS" : "FAIL"}  ${line(label, detail)}`)
      if (stopsHere(pass, label, stopAt)) {
        print("  STOP  at the check PINETRIE_STOP_AT names")
        throw new Error(stopMessage(label))
      }
    },
    skip(label, why) {
      skipped.push(label)
      skips.push(why)
      print(`  SKIP  ${line(label, skipWords(why))}`)
    },
    error(scenario, message) {
      failed.push(scenario)
      print(`  ERROR ${line(scenario, message)}`)
    },
    report(title, children = NO_COUNTS) {
      const counts = sumSuiteCounts(
        {
          passed: passed.length,
          failed: failed.length,
          skipsBy: skipCounts(skips),
        },
        children,
      )
      print(
        `\n${tallyLine(title, {
          pass: counts.passed,
          fail: counts.failed,
          skip: skippedTotal(counts),
        })}`,
      )
      print(suiteSummaryLine(counts))
      process.exit(counts.failed > 0 ? 1 : 0)
    },
  }
}

/** How many checks passed, failed and were skipped. */
interface Tally {
  readonly pass: number
  readonly fail: number
  readonly skip: number
}

/** A suite's last line: its title and its tally. */
const tallyLine = (title: string, t: Tally): string =>
  `=== ${title}: pass=${t.pass} fail=${t.fail} skip=${t.skip} ===`
