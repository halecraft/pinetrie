import { entryId, type ThreadId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  askingLanes,
  CONFLICT_ASK,
  type ConflictAskRecord,
  planConflictAsk,
} from "./conflict-ask.ts"
import { setRecord } from "./records.ts"
import {
  pendingRunEndReport,
  type RunEndReportRecord,
} from "./run-end-report.ts"

const LANE = threadIdFor("0123456789abcdef")
const OTHER = threadIdFor("fedcba9876543210")
const RUN = entryId("e-run")
const NEXT = entryId("e-next")

describe("planConflictAsk", () => {
  test("a copy with a conflict is asked about, and the ask names its run", () => {
    expect(planConflictAsk(LANE, ["a.txt"], RUN)).toEqual({
      kind: "asked",
      writes: [setRecord(CONFLICT_ASK, { lane: LANE, run: RUN })],
    })
  })

  test("a copy with no conflict asks nothing and records nothing", () => {
    expect(planConflictAsk(LANE, [], RUN)).toEqual({ kind: "no-conflict" })
  })

  test("a conflict with no run to name is not asked about", () => {
    expect(planConflictAsk(LANE, ["a.txt"], null)).toEqual({ kind: "no-run" })
  })

  test("the record decodes as it was written", () => {
    const plan = planConflictAsk(LANE, ["a.txt"], RUN)
    const [write] = plan.kind === "asked" ? plan.writes : []
    expect(
      write?.kind === "set"
        ? CONFLICT_ASK.decode(write.value, write.key)
        : undefined,
    ).toEqual({ lane: LANE, run: RUN })
  })
})

describe("askingLanes", () => {
  const asks = (
    ...records: ConflictAskRecord[]
  ): ReadonlyMap<ThreadId, ConflictAskRecord> =>
    new Map(records.map(r => [r.lane, r]))
  const reports = (
    ...records: RunEndReportRecord[]
  ): ReadonlyMap<ThreadId, RunEndReportRecord> =>
    new Map(records.map(r => [r.lane, r]))

  test("an ask stands while the lane's last run is the one that asked", () => {
    expect(
      askingLanes(
        asks({ lane: LANE, run: RUN }),
        reports(pendingRunEndReport(LANE, RUN, entryId("e-end"))),
      ),
    ).toEqual(new Set([LANE]))
  })

  test("a later run's report ends the ask", () => {
    expect(
      askingLanes(
        asks({ lane: LANE, run: RUN }),
        reports(pendingRunEndReport(LANE, NEXT, entryId("e-end"))),
      ),
    ).toEqual(new Set())
  })

  test("a lane with no report is not asking", () => {
    expect(
      askingLanes(
        asks({ lane: LANE, run: RUN }),
        reports(pendingRunEndReport(OTHER, RUN, entryId("e-end"))),
      ),
    ).toEqual(new Set())
  })
})
