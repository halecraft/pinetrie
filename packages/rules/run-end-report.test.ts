import {
  type AskOutcome,
  type DigestRecord,
  entryId,
  type RunEndReportRecord,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { AskLines, DigestPlan } from "./digest.ts"
import {
  DIGEST,
  decodeRecords,
  digestRequest,
  parseEndReply,
  parseUrgencyLine,
  pendingRunEndReport,
  planRunEnded,
  RUN_END_REPORT,
  runEndedToWrite,
} from "./index.ts"
import { REASON_WORDS } from "./run-end-report.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE = threadIdFor("1")
const ASK = entryId("p-1")
const END = entryId("w-3")
const ADA = writerId("ada@x.io")

describe("parseUrgencyLine", () => {
  const long = Array.from({ length: REASON_WORDS + 1 }, () => "word").join(" ")
  test.each([
    [
      "needs you: asks whether to drop the v1 table",
      { urgency: "needsYou", reason: "asks whether to drop the v1 table" },
    ],
    [
      "Needs you: which database to use?",
      { urgency: "needsYou", reason: "which database to use?" },
    ],
    [
      "worth a read: explains why the cache misses.",
      { urgency: "worthARead", reason: "explains why the cache misses" },
    ],
    ["done", { urgency: "done", reason: null }],
    ["Done.", { urgency: "done", reason: null }],
    ["done: nothing more to do", { urgency: "done", reason: null }],
    [
      '"needs you: pick a name"',
      { urgency: "needsYou", reason: "pick a name" },
    ],
    ["needs you", null],
    ["needs you:", null],
    [`worth a read: ${long}`, null],
    ["finished: all good", null],
    ["", null],
  ])("%j", (line, expected) => {
    expect(parseUrgencyLine(line)).toEqual(expected)
  })
})

describe("parseEndReply", () => {
  test("an urgency line alone is the reply's only line", () => {
    expect(parseEndReply("needs you: pick a name", "urgency")).toEqual({
      urgency: { urgency: "needsYou", reason: "pick a name" },
      digest: null,
    })
    expect(parseEndReply("done\nAll tests pass.", "urgency")).toEqual({
      urgency: null,
      digest: null,
    })
  })

  test("an urgency line and a digest: the first line, then the rest", () => {
    expect(
      parseEndReply(
        "worth a read: why the rail drifts\n\nRail drift traced to rounding\n- `rail.tsx` rounds twice",
        "urgency and digest",
      ),
    ).toEqual({
      urgency: { urgency: "worthARead", reason: "why the rail drifts" },
      digest: {
        headline: "Rail drift traced to rounding",
        points: ["`rail.tsx` rounds twice"],
      },
    })
  })

  test("each half is refused on its own", () => {
    expect(
      parseEndReply("I think it is done\nFixed the rail", "urgency and digest"),
    ).toEqual({
      urgency: null,
      digest: { headline: "Fixed the rail", points: [] },
    })
    expect(
      parseEndReply("done\n- a point with no headline", "urgency and digest"),
    ).toEqual({ urgency: { urgency: "done", reason: null }, digest: null })
  })

  test("a digest alone is read as a digest", () => {
    expect(parseEndReply("Fixed the rail", "digest")).toEqual({
      urgency: null,
      digest: { headline: "Fixed the rail", points: [] },
    })
  })
})

describe("planRunEnded", () => {
  const lines: AskLines = {
    said: "Ada: fix the rail",
    work: ["agent: reading"],
    shown: "agent: fixed",
  }
  const digest: DigestPlan = { ...lines, final: true, previous: "Reading" }
  const answered: AskOutcome = { kind: "answered" }

  test("an answered run asks for its urgency, with its digest when one is due", () => {
    expect(
      planRunEnded({ current: true, outcome: answered, lines, digest: null }),
    ).toEqual({
      report: null,
      request: { answer: "urgency", lines, previous: null },
    })
    expect(
      planRunEnded({ current: true, outcome: answered, lines, digest }),
    ).toEqual({
      report: null,
      request: {
        answer: "urgency and digest",
        lines: digest,
        previous: "Reading",
      },
    })
  })

  test("a failed or stopped run's end report is its facts; only a due digest is asked for", () => {
    const failed: AskOutcome = { kind: "failed", error: "rate limited" }
    expect(
      planRunEnded({ current: true, outcome: failed, lines, digest: null }),
    ).toEqual({
      report: { kind: "failed", error: "rate limited" },
      request: null,
    })
    expect(
      planRunEnded({
        current: true,
        outcome: { kind: "stopped", by: ADA },
        lines,
        digest,
      }),
    ).toEqual({
      report: { kind: "stopped", by: ADA },
      request: { answer: "digest", lines: digest, previous: "Reading" },
    })
  })

  test("a run whose end report the next run's end replaced gets none; its digest is still asked for", () => {
    expect(
      planRunEnded({ current: false, outcome: answered, lines, digest }),
    ).toEqual({
      report: null,
      request: { answer: "digest", lines: digest, previous: "Reading" },
    })
    expect(
      planRunEnded({ current: false, outcome: answered, lines, digest: null }),
    ).toEqual({ report: null, request: null })
  })

  test("a run with nothing to read is unclassified, and nothing is asked", () => {
    expect(
      planRunEnded({
        current: true,
        outcome: answered,
        lines: null,
        digest: null,
      }),
    ).toEqual({ report: { kind: "unclassified" }, request: null })
  })
})

describe("runEndedToWrite", () => {
  const pending: RunEndReportRecord = pendingRunEndReport(LANE, ASK, END)
  const write = (
    over: Partial<Parameters<typeof runEndedToWrite>[0]> = {},
  ): {
    report: RunEndReportRecord | undefined
    digest: DigestRecord | undefined
  } => {
    const writes = runEndedToWrite({
      root: ROOT,
      lane: LANE,
      ask: ASK,
      end: END,
      answer: "urgency and digest",
      stored: { report: pending, digest: undefined },
      reply: {
        urgency: { urgency: "needsYou", reason: "pick a name" },
        digest: { headline: "Named the rail", points: [] },
      },
      at: 5,
      ...over,
    })
    const sets = (namespace: string) =>
      writes.flatMap(w =>
        w.kind === "set" && w.namespace === namespace ? [w] : [],
      )
    return {
      report: decodeRecords(RUN_END_REPORT, sets(RUN_END_REPORT.namespace)).get(
        LANE,
      ),
      digest: decodeRecords(DIGEST, sets(DIGEST.namespace)).get(ASK),
    }
  }

  test("both halves, in one write", () => {
    expect(write()).toEqual({
      report: {
        lane: LANE,
        ask: ASK,
        end: END,
        report: {
          kind: "modelSaid",
          urgency: "needsYou",
          reason: "pick a name",
        },
      },
      digest: {
        prompt: ASK,
        headline: "Named the rail",
        points: [],
        at: 5,
        final: true,
      },
    })
  })

  test("a failed request is unclassified, and writes no digest", () => {
    expect(write({ reply: null })).toEqual({
      report: { ...pending, report: { kind: "unclassified" } },
      digest: undefined,
    })
  })

  test("a refused urgency line is unclassified, and its good digest is kept", () => {
    const { report, digest } = write({
      reply: {
        urgency: null,
        digest: { headline: "Named the rail", points: [] },
      },
    })
    expect(report?.report).toEqual({ kind: "unclassified" })
    expect(digest?.headline).toBe("Named the rail")
  })

  test("a reply for a run the next run's end has replaced writes no run-end report", () => {
    const next = pendingRunEndReport(LANE, entryId("p-2"), entryId("w-9"))
    const { report, digest } = write({
      stored: { report: next, digest: undefined },
    })
    expect(report).toBeUndefined()
    expect(digest?.headline).toBe("Named the rail")
  })

  test("a digest alone writes no run-end report, which the facts wrote", () => {
    expect(write({ answer: "digest" }).report).toBeUndefined()
  })

  test("an urgency line alone writes no digest", () => {
    expect(write({ answer: "urgency" }).digest).toBeUndefined()
  })
})

test("digestRequest asks for the urgency line, alone or with the summary", () => {
  const base = {
    skill: "",
    ask: "Ada: fix the rail",
    work: [],
    shown: null,
    previous: null,
    budget: 1000,
  }
  expect(digestRequest({ ...base, answer: "urgency" }).user).toContain(
    "Answer with the urgency line alone.",
  )
  expect(
    digestRequest({ ...base, answer: "urgency and digest" }).user,
  ).toContain("Answer with the urgency line, then the summary.")
  expect(digestRequest({ ...base, answer: "digest" }).user).not.toContain(
    "Answer with",
  )
})
