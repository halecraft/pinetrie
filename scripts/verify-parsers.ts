// scripts/verify-parsers — `verify.config.ts`' own parsers, which put on a
// passing task's line what it did not run. Each reads the line its tool
// marks: a task's output is stdout and stderr as they came, so the last line
// is anyone's. Without the line, a parser gives null and `verify` says only
// passed or failed. Pass or fail is the task's exit, never a parser's.

import type { OutputParser } from "@halecraft/verify"
import { SUITE_MARK } from "../apps/pinetrie/e2e/checks.ts"

/** The text after `mark` on the last line that starts with it, or null. */
export function markedText(output: string, mark: string): string | null {
  const line = output
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith(mark))
    .at(-1)
  return line === undefined ? null : line.slice(mark.length)
}

/** A parser whose summary is the text of the line `mark` starts. */
const markedParser = (id: string, mark: string): OutputParser => ({
  id,
  parse(output) {
    const text = markedText(output, mark)
    return text === null ? null : { summary: text }
  },
})

/** `scripts/requirements-report.ts`' line: where the unit tests ran. */
export const REQUIREMENTS_MARK = "requirements: "

export const VERIFY_PARSERS: readonly OutputParser[] = [
  markedParser("requirements", REQUIREMENTS_MARK),
  markedParser("suite", SUITE_MARK),
]
