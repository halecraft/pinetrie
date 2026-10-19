import { expect, test } from "vitest"
import { runEndReportNow } from "./0025-run-end-report.ts"

const stored = (report: object) => ({ ask: "a", end: "e", report })

test("a model's report and its urgency get the new spellings", () => {
  expect(
    runEndReportNow(
      stored({ kind: "modelSaid", urgency: "needsYou", reason: "look" }),
    ),
  ).toEqual(
    stored({ kind: "model-said", urgency: "needs-you", reason: "look" }),
  )
  expect(
    runEndReportNow(
      stored({ kind: "modelSaid", urgency: "worthARead", reason: "r" }),
    ),
  ).toEqual(
    stored({ kind: "model-said", urgency: "worth-a-read", reason: "r" }),
  )
})

test("a report with nothing to respell, or in the new spelling, needs nothing", () => {
  for (const report of [
    { kind: "pending" },
    { kind: "failed", error: "x" },
    { kind: "stopped", by: null },
    { kind: "unclassified" },
    { kind: "model-said", urgency: "done", reason: null },
  ])
    expect(runEndReportNow(stored(report))).toBeNull()
})
