import {
  entryId,
  type RunEndReport,
  type RunEndReportRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import type { Attention } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { type AttentionInput, standingRunEnds } from "./attention.ts"
import { columnStatus } from "./column-status.ts"

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const A = threadIdFor("a")
const NAMES = new Map([
  [ADA, "Ada"],
  [BEA, "Bea"],
])
const nameOf = (w: typeof ADA) => NAMES.get(w) ?? "someone"

const record = (report: RunEndReport): RunEndReportRecord => ({
  lane: A,
  ask: entryId("p-1"),
  end: entryId("e-5"),
  report,
})
const needsYou: RunEndReport = {
  kind: "modelSaid",
  urgency: "needsYou",
  reason: "asks whether to drop the v1 table",
}

const person = (over: Partial<Attention> = {}): Attention => ({
  since: "e-0",
  mentionsSince: "e-0",
  read: new Map(),
  dismissed: new Map(),
  dismissedReady: new Map(),
  seen: new Set(),
  ...over,
})

/** Ada's status line for thread A, which Ada and Bea wrote in. */
const statusOf = (report: RunEndReport, over: Partial<AttentionInput> = {}) =>
  columnStatus(
    standingRunEnds({
      me: ADA,
      writers: new Map([[A, [ADA, BEA]]]),
      runEndReports: new Map([[A, record(report)]]),
      openProposed: [],
      sshAsks: [],
      owner: null,
      person: person(),
      busy: new Set(),
      archived: new Set(),
      ...over,
    }).get(A),
    nameOf,
  )

describe("columnStatus", () => {
  test("a run that needs you shows its reason in the header", () => {
    expect(statusOf(needsYou)).toEqual({
      level: "needsYou",
      quiet: false,
      words: "needs you: asks whether to drop the v1 table",
      end: entryId("e-5"),
    })
  })

  test("a stop is worth a read for others and shows nothing for whoever stopped it", () => {
    const stopped: RunEndReport = { kind: "stopped", by: BEA }
    expect(statusOf(stopped)?.words).toBe("worth a read: Bea stopped it")
    expect(statusOf(stopped, { me: BEA })).toBe(null)
  })

  test("a failed run needs you, with its error", () => {
    expect(statusOf({ kind: "failed", error: "out of disk" })?.words).toBe(
      "needs you: the run failed: out of disk",
    )
  })

  test("read past, the line stays and is quiet", () => {
    const read = person({ read: new Map([[A, entryId("e-5")]]) })
    expect(statusOf(needsYou, { person: read })).toMatchObject({
      quiet: true,
      words: "needs you: asks whether to drop the v1 table",
    })
  })

  test("a dismissed report is quiet", () => {
    const dismissed = person({ dismissed: new Map([[A, entryId("p-1")]]) })
    expect(statusOf(needsYou, { person: dismissed })?.quiet).toBe(true)
  })

  test("a report from before you started is quiet", () => {
    expect(
      statusOf(needsYou, { person: person({ since: "e-9" }) })?.quiet,
    ).toBe(true)
    expect(statusOf(needsYou, { person: person({ since: "" }) })?.quiet).toBe(
      true,
    )
  })

  test("a done run shows nothing", () => {
    expect(statusOf({ kind: "modelSaid", urgency: "done", reason: null })).toBe(
      null,
    )
  })

  test("a pending report shows nothing", () => {
    expect(statusOf({ kind: "pending" })).toBe(null)
  })

  test("a busy lane shows nothing", () => {
    expect(statusOf(needsYou, { busy: new Set([A]) })).toBe(null)
  })

  test("a reader who does not follow the thread sees nothing", () => {
    expect(statusOf(needsYou, { writers: new Map([[A, [BEA]]]) })).toBe(null)
  })

  test("an archived canvas's thread shows nothing", () => {
    expect(statusOf(needsYou, { archived: new Set([A]) })).toBe(null)
  })
})
