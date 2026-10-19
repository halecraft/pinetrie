// host/migrations/0025-run-end-report — each run-end report moves from
// `pinetrie.runEndReport` to `RUN_END_REPORT`'s namespace, its tags in
// kebab-case: a model's report is `model-said`, and its urgency `needs-you`
// or `worth-a-read`. Read raw, since the old shape no longer decodes; a
// value it does not know moves as stored. Over its own output the old
// namespace is empty, so it plans nothing.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { RUN_END_REPORT } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

const KINDS: Readonly<Record<string, string>> = { modelSaid: "model-said" }
const URGENCIES: Readonly<Record<string, string>> = {
  needsYou: "needs-you",
  worthARead: "worth-a-read",
}

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const respelled = (
  value: unknown,
  spellings: Readonly<Record<string, string>>,
): unknown => (typeof value === "string" ? (spellings[value] ?? value) : value)

/** A stored run-end report with its report's tags respelled; null for one with none to change. */
export function runEndReportNow(contents: unknown): object | null {
  if (!isRaw(contents) || !isRaw(contents.report)) return null
  const { report } = contents
  const kind = respelled(report.kind, KINDS)
  const urgency = respelled(report.urgency, URGENCIES)
  if (kind === report.kind && urgency === report.urgency) return null
  return {
    ...contents,
    report: {
      ...report,
      kind,
      ...("urgency" in report ? { urgency } : {}),
    },
  }
}

export const runEndReportMigration = rewriteRecords({
  name: "0025-run-end-report",
  namespace: "pinetrie.runEndReport",
  to: RUN_END_REPORT.namespace,
  home: RUN_END_REPORT.home,
  rewrite: runEndReportNow,
})
