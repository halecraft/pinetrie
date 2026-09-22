// e2e/harness — the assertion bookkeeping both end-to-end checks share.
//
// Extracted because e2e.ts and browser.ts had grown two `ok()` helpers with
// *different* internal representations (counters vs. arrays) doing the same
// job, plus two copies of the report-and-exit tail. One of anything is enough.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

export interface Checks {
  /** Record an assertion. Truthy passes. */
  ok(condition: unknown, label: string): void
  /** Print the tally and exit non-zero if anything failed. Never returns. */
  report(title: string): never
  readonly passed: readonly string[]
  readonly failed: readonly string[]
}

export function createChecks(): Checks {
  const passed: string[] = []
  const failed: string[] = []

  return {
    passed,
    failed,
    ok(condition, label) {
      ;(condition ? passed : failed).push(label)
      console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}`)
    },
    report(title) {
      console.log(
        `\n=== ${title}: pass=${passed.length} fail=${failed.length} ===`,
      )
      process.exit(failed.length > 0 ? 1 : 0)
    },
  }
}
