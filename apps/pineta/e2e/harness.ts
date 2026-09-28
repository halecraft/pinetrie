// e2e/harness — the assertion bookkeeping both end-to-end checks share.
//
// Extracted because e2e.ts and browser.ts had grown two `ok()` helpers with
// *different* internal representations (counters vs. arrays) doing the same
// job, plus two copies of the report-and-exit tail. One of anything is enough.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

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

/**
 * Poll until `pred` holds. Resolves with the elapsed milliseconds, or -1 on
 * timeout. Shared by both suites so each does not grow its own copy.
 */
export async function waitFor(
  pred: () => boolean,
  timeoutMs = 60_000,
): Promise<number> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return Date.now() - t0
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return -1
}

/**
 * A project for a host with tools: a jj repo, colocated with git, with
 * `files` committed. A lane starts from your committed work (`@-`,
 * ADR-0032), so what its agent should see must be committed. The path is the
 * real one (on macOS a temporary directory is behind a symlink), as jj names
 * it.
 */
export function committedProject(
  prefix: string,
  files: Readonly<Record<string, string>>,
): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  const jj = (...args: string[]) =>
    execFileSync("jj", ["--no-pager", ...args], { cwd: dir, stdio: "pipe" })
  jj("git", "init", "--colocate")
  jj("config", "set", "--repo", "user.name", "Pineta e2e")
  jj("config", "set", "--repo", "user.email", "e2e@pineta.invalid")
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  jj("commit", "-m", "the project")
  return dir
}
