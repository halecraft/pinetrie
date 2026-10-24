// scripts/requirements-report — where each unit test ran, by what it
// requires: the tests here (Vitest's JSON report) and those the lane ran
// (`apps/pinetrie/scripts/lane-tests.ts`'s), against the plan the lane was
// made by. A test planned for the lane that the lane did not run fails it:
// no test is lost between the two places. One that can run nowhere is
// listed, with why, and fails nothing. Its last line is marked
// (`requirements: …`) for `verify`'s parser (`scripts/verify-parsers.ts`).
//
// Run: node scripts/requirements-report.ts, a task of `verify`
// (`checks:unit:report`), after the two that write its reports.

import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  type RequirementPlace,
  requirementWords,
  testPlace,
  testRequirements,
  UNIT_REPORTS,
  UNIT_REQUIREMENTS,
  type UnitRequirement,
} from "../apps/pinetrie/e2e/requirements.ts"
import type { LaneReport } from "../apps/pinetrie/scripts/lane-tests.ts"

/** A test as a Vitest JSON report gives it. */
export interface TestOutcome {
  /** Its file, from the checkout's root. */
  readonly file: string
  readonly name: string
  readonly status: string
  readonly tags: readonly string[]
}

const RAN = new Set(["passed", "failed"])

/**
 * The tests of a Vitest JSON report, their files from the checkout's root
 * (`root` as the report wrote it: the Mac's path here, the lane's copy
 * there). A report that is not one gives none.
 */
export function reportedTests(json: unknown, root: string): TestOutcome[] {
  const results = (json as { testResults?: unknown } | null)?.testResults
  if (!Array.isArray(results)) return []
  return results.flatMap(
    (file: {
      name?: string
      assertionResults?: {
        fullName?: string
        status?: string
        tags?: string[]
      }[]
    }) =>
      (file.assertionResults ?? []).map(t => ({
        file: path.relative(root, file.name ?? ""),
        name: t.fullName ?? "",
        status: t.status ?? "",
        tags: t.tags ?? [],
      })),
  )
}

export interface RequirementsReport {
  /** By requirement: its tests that ran here, in the lane, and nowhere. */
  readonly counts: Readonly<
    Record<
      UnitRequirement,
      { readonly here: number; readonly lane: number; readonly nowhere: number }
    >
  >
  /** Tests that ran here with no requirement. */
  readonly untagged: number
  /** Tests planned for the lane that it did not run. */
  readonly lost: readonly TestOutcome[]
  /** Each requirement met nowhere, with why. */
  readonly unmet: readonly {
    readonly requirement: UnitRequirement
    readonly why: string
  }[]
  /** Why the lane did not run, when one was planned. */
  readonly laneFailed: string | null
}

/**
 * Where each test ran, by the plan: a test the plan puts here counts here;
 * one it puts in the lane counts there when the lane's report has it run,
 * and is lost otherwise; one it puts nowhere counts under its unmet
 * requirement.
 */
export function planVerifyReport(input: {
  readonly plan: Readonly<Record<UnitRequirement, RequirementPlace>>
  readonly here: readonly TestOutcome[]
  readonly lane: readonly TestOutcome[]
  readonly laneFailed: string | null
}): RequirementsReport {
  const counts = Object.fromEntries(
    UNIT_REQUIREMENTS.map(r => [r, { here: 0, lane: 0, nowhere: 0 }]),
  ) as Record<UnitRequirement, { here: number; lane: number; nowhere: number }>
  const ranInLane = new Set(
    input.lane.filter(t => RAN.has(t.status)).map(t => `${t.file}\n${t.name}`),
  )
  let untagged = 0
  const lost: TestOutcome[] = []
  for (const t of input.here) {
    const requirements = testRequirements(t.tags)
    if (requirements.length === 0) {
      untagged++
      continue
    }
    const place = testPlace(requirements, input.plan)
    if (place.kind === "unmet") {
      counts[place.requirement].nowhere++
      continue
    }
    if (place.kind === "lane" && !ranInLane.has(`${t.file}\n${t.name}`)) {
      lost.push(t)
      continue
    }
    for (const r of requirements) counts[r][place.kind]++
  }
  const unmet = UNIT_REQUIREMENTS.flatMap(requirement => {
    const p = input.plan[requirement]
    return p.kind === "unmet" && counts[requirement].nowhere > 0
      ? [{ requirement, why: p.why }]
      : []
  })
  return { counts, untagged, lost, unmet, laneFailed: input.laneFailed }
}

/** The marked line `verify`'s `requirements` parser reads. */
export function requirementsSummaryLine(report: RequirementsReport): string {
  const sum = (k: "here" | "lane" | "nowhere") =>
    UNIT_REQUIREMENTS.reduce((n, r) => n + report.counts[r][k], 0)
  const parts = [
    `${sum("here")} here`,
    `${sum("lane")} in a lane`,
    ...(report.lost.length > 0
      ? [`${report.lost.length} planned for the lane, not run there`]
      : []),
    ...(report.unmet.length > 0
      ? [
          `${sum("nowhere")} run nowhere: ${report.unmet.map(u => u.requirement).join(", ")}`,
        ]
      : []),
  ]
  return `requirements: ${parts.join(" · ")}`
}

/** The report as lines: by requirement, what was lost and why, then the marked line. */
export function verifyReportLines(report: RequirementsReport): string[] {
  const lines = UNIT_REQUIREMENTS.map(r => {
    const c = report.counts[r]
    return `  ${r} (${requirementWords(r)}): ${c.here} here, ${c.lane} in a lane, ${c.nowhere} nowhere`
  })
  lines.push(`  ${report.untagged} tests need nothing of the place, run here`)
  if (report.laneFailed !== null)
    lines.push(`  the lane did not run: ${report.laneFailed}`)
  for (const t of report.lost)
    lines.push(`  planned for the lane, not run there: ${t.file} > ${t.name}`)
  for (const u of report.unmet) lines.push(`  run nowhere: ${u.why}`)
  lines.push(requirementsSummaryLine(report))
  return lines
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = path.resolve(import.meta.dirname, "..")
  const read = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(file, "utf8"))
    } catch {
      return null
    }
  }
  const here = reportedTests(read(path.join(root, UNIT_REPORTS.here)), root)
  const lane = read(path.join(root, UNIT_REPORTS.lane)) as LaneReport | null
  if (here.length === 0 || lane === null) {
    console.log(
      `no ${here.length === 0 ? "report of the tests here" : "lane report"}: run checks:unit:here and checks:unit:lane first`,
    )
    process.exit(1)
  }
  const report = planVerifyReport({
    plan: lane.plan,
    here,
    lane: reportedTests(lane.vitest, lane.root),
    laneFailed: lane.failed,
  })
  for (const line of verifyReportLines(report)) console.log(line)
  process.exit(report.lost.length > 0 || report.laneFailed !== null ? 1 : 0)
}
