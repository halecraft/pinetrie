// e2e/checks — how the end-to-end suites record a check, and when a suite
// stops at one.
//
// Every suite records and reports its checks here, so they read and exit
// alike. It imports nothing, so its test loads at once.

export interface Checks {
  /**
   * Record an assertion. Truthy passes. A failing check whose label names
   * `PINETA_STOP_AT` ends the suite (`stopsHere`).
   */
  ok(condition: unknown, label: string): void
  /** Print the tally and exit non-zero if anything failed. Never returns. */
  report(title: string): never
  readonly passed: readonly string[]
  readonly failed: readonly string[]
}

/**
 * Whether a check's result ends the suite: it failed, and its label names
 * `stopAt`. `judge` in `scripts/mutate.ts` counts a mutant KILLED by the same
 * rule, a FAIL line that contains `expect`, and `mutate` passes `expect` as
 * `PINETA_STOP_AT`: nothing after that check can change the verdict.
 */
export const stopsHere = (
  passed: boolean,
  label: string,
  stopAt: string | undefined,
): boolean =>
  !passed && stopAt !== undefined && stopAt !== "" && label.includes(stopAt)

/** The message of the error `ok()` throws to end the suite. */
export const stopMessage = (label: string): string =>
  `stopped at the check PINETA_STOP_AT names: ${label}`

/**
 * `stopAt` defaults to `PINETA_STOP_AT`. A stop throws rather than exits, so
 * every `finally` on the way out runs: `e2e:lanes` removes its containers and
 * volumes in them.
 */
export function createChecks(
  stopAt: string | undefined = process.env.PINETA_STOP_AT,
  print: (line: string) => void = console.log,
): Checks {
  const passed: string[] = []
  const failed: string[] = []

  return {
    passed,
    failed,
    ok(condition, label) {
      const pass = Boolean(condition)
      ;(pass ? passed : failed).push(label)
      print(`  ${pass ? "PASS" : "FAIL"}  ${label}`)
      if (stopsHere(pass, label, stopAt)) {
        print("  STOP  at the check PINETA_STOP_AT names")
        throw new Error(stopMessage(label))
      }
    },
    report(title) {
      print(`\n=== ${title}: pass=${passed.length} fail=${failed.length} ===`)
      process.exit(failed.length > 0 ? 1 : 0)
    },
  }
}
