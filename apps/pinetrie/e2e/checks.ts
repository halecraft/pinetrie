// e2e/checks — how the end-to-end suites record a check, and when a suite
// stops at one.
//
// Every scenario records its checks here, so they read and exit alike. It
// imports nothing, so its test loads at once.

export interface Checks {
  /**
   * Record an assertion. Truthy passes. `label` is a string literal, which a
   * mutation's `expect` names exactly (`scripts/proofs.ts`); what a run found
   * goes in `detail`, printed after it. A failing check whose label is
   * `PINETRIE_STOP_AT` ends the suite (`stopsHere`).
   */
  check(label: string, condition: unknown, detail?: string): void
  /** A check that could not run here, and why: neither a pass nor a fail. */
  skip(label: string, why: string): void
  /** A scenario that threw: a failure under the scenario's name. */
  error(scenario: string, message: string): void
  /** Print the tally and exit non-zero if anything failed. Never returns. */
  report(title: string): never
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
      print(`  SKIP  ${line(label, why)}`)
    },
    error(scenario, message) {
      failed.push(scenario)
      print(`  ERROR ${line(scenario, message)}`)
    },
    report(title) {
      print(
        `\n=== ${title}: pass=${passed.length} fail=${failed.length} skip=${skipped.length} ===`,
      )
      process.exit(failed.length > 0 ? 1 : 0)
    },
  }
}
