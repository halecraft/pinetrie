import {
  type AskOutcome,
  type DigestRecord,
  entryId,
  laneNameForThread,
  rootIdFor,
  type VerdictRecord,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import type { AskLines, DigestPlan } from "./digest.ts"
import {
  DIGEST,
  digestRequest,
  endReplyOf,
  pendingVerdict,
  planRunEnded,
  recordsOf,
  runEndedToWrite,
  VERDICT,
  verdictOf,
} from "./index.ts"
import { REASON_WORDS } from "./verdict.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const LANE = laneNameForThread("1")
const ASK = entryId("p-1")
const END = entryId("w-3")
const ADA = writerId("ada@x.io")

describe("verdictOf", () => {
  const long = Array.from({ length: REASON_WORDS + 1 }, () => "word").join(" ")
  test.each([
    [
      "needs you: asks whether to drop the v1 table",
      { said: "needsYou", reason: "asks whether to drop the v1 table" },
    ],
    [
      "Needs you: which database to use?",
      { said: "needsYou", reason: "which database to use?" },
    ],
    [
      "worth a read: explains why the cache misses.",
      { said: "worthARead", reason: "explains why the cache misses" },
    ],
    ["done", { said: "done", reason: null }],
    ["Done.", { said: "done", reason: null }],
    ["done: nothing more to do", { said: "done", reason: null }],
    ['"needs you: pick a name"', { said: "needsYou", reason: "pick a name" }],
    ["needs you", null],
    ["needs you:", null],
    [`worth a read: ${long}`, null],
    ["finished: all good", null],
    ["", null],
  ])("%j", (line, expected) => {
    expect(verdictOf(line)).toEqual(expected)
  })
})

describe("endReplyOf", () => {
  test("a verdict alone is the reply's only line", () => {
    expect(endReplyOf("needs you: pick a name", "verdict")).toEqual({
      verdict: { said: "needsYou", reason: "pick a name" },
      digest: null,
    })
    expect(endReplyOf("done\nAll tests pass.", "verdict")).toEqual({
      verdict: null,
      digest: null,
    })
  })

  test("a verdict and a digest: the first line, then the rest", () => {
    expect(
      endReplyOf(
        "worth a read: why the rail drifts\n\nRail drift traced to rounding\n- `rail.tsx` rounds twice",
        "verdict and digest",
      ),
    ).toEqual({
      verdict: { said: "worthARead", reason: "why the rail drifts" },
      digest: {
        headline: "Rail drift traced to rounding",
        points: ["`rail.tsx` rounds twice"],
      },
    })
  })

  test("each half is refused on its own", () => {
    expect(
      endReplyOf("I think it is done\nFixed the rail", "verdict and digest"),
    ).toEqual({
      verdict: null,
      digest: { headline: "Fixed the rail", points: [] },
    })
    expect(
      endReplyOf("done\n- a point with no headline", "verdict and digest"),
    ).toEqual({ verdict: { said: "done", reason: null }, digest: null })
  })

  test("a digest alone is read as a digest", () => {
    expect(endReplyOf("Fixed the rail", "digest")).toEqual({
      verdict: null,
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

  test("an answered run asks for its verdict, with its digest when one is due", () => {
    expect(
      planRunEnded({ current: true, outcome: answered, lines, digest: null }),
    ).toEqual({
      verdict: null,
      request: { answer: "verdict", lines, previous: null },
    })
    expect(
      planRunEnded({ current: true, outcome: answered, lines, digest }),
    ).toEqual({
      verdict: null,
      request: {
        answer: "verdict and digest",
        lines: digest,
        previous: "Reading",
      },
    })
  })

  test("a failed or stopped run's verdict is its facts; only a due digest is asked for", () => {
    const failed: AskOutcome = { kind: "failed", error: "rate limited" }
    expect(
      planRunEnded({ current: true, outcome: failed, lines, digest: null }),
    ).toEqual({
      verdict: { kind: "failed", error: "rate limited" },
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
      verdict: { kind: "stopped", by: ADA },
      request: { answer: "digest", lines: digest, previous: "Reading" },
    })
  })

  test("a run whose verdict the next run's end replaced gets none; its digest is still asked for", () => {
    expect(
      planRunEnded({ current: false, outcome: answered, lines, digest }),
    ).toEqual({
      verdict: null,
      request: { answer: "digest", lines: digest, previous: "Reading" },
    })
    expect(
      planRunEnded({ current: false, outcome: answered, lines, digest: null }),
    ).toEqual({ verdict: null, request: null })
  })

  test("a run with nothing to read is unclassified, and nothing is asked", () => {
    expect(
      planRunEnded({
        current: true,
        outcome: answered,
        lines: null,
        digest: null,
      }),
    ).toEqual({ verdict: { kind: "unclassified" }, request: null })
  })
})

describe("runEndedToWrite", () => {
  const pending: VerdictRecord = pendingVerdict(LANE, ASK, END)
  const write = (
    over: Partial<Parameters<typeof runEndedToWrite>[0]> = {},
  ): {
    verdict: VerdictRecord | undefined
    digest: DigestRecord | undefined
  } => {
    const writes = runEndedToWrite({
      root: ROOT,
      lane: LANE,
      ask: ASK,
      end: END,
      answer: "verdict and digest",
      stored: { verdict: pending, digest: undefined },
      reply: {
        verdict: { said: "needsYou", reason: "pick a name" },
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
      verdict: recordsOf(VERDICT, sets(VERDICT.namespace)).get(LANE),
      digest: recordsOf(DIGEST, sets(DIGEST.namespace)).get(ASK),
    }
  }

  test("both halves, in one write", () => {
    expect(write()).toEqual({
      verdict: {
        lane: LANE,
        ask: ASK,
        end: END,
        verdict: { kind: "said", said: "needsYou", reason: "pick a name" },
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
      verdict: { ...pending, verdict: { kind: "unclassified" } },
      digest: undefined,
    })
  })

  test("a refused verdict line is unclassified, and its good digest is kept", () => {
    const { verdict, digest } = write({
      reply: {
        verdict: null,
        digest: { headline: "Named the rail", points: [] },
      },
    })
    expect(verdict?.verdict).toEqual({ kind: "unclassified" })
    expect(digest?.headline).toBe("Named the rail")
  })

  test("a reply for a run the next run's end has replaced writes no verdict", () => {
    const next = pendingVerdict(LANE, entryId("p-2"), entryId("w-9"))
    const { verdict, digest } = write({
      stored: { verdict: next, digest: undefined },
    })
    expect(verdict).toBeUndefined()
    expect(digest?.headline).toBe("Named the rail")
  })

  test("a digest alone writes no verdict, which the facts wrote", () => {
    expect(write({ answer: "digest" }).verdict).toBeUndefined()
  })

  test("a verdict alone writes no digest", () => {
    expect(write({ answer: "verdict" }).digest).toBeUndefined()
  })
})

test("digestRequest asks for the verdict line, alone or with the summary", () => {
  const base = {
    skill: "",
    ask: "Ada: fix the rail",
    work: [],
    shown: null,
    previous: null,
    budget: 1000,
  }
  expect(digestRequest({ ...base, answer: "verdict" }).user).toContain(
    "Answer with the verdict line alone.",
  )
  expect(
    digestRequest({ ...base, answer: "verdict and digest" }).user,
  ).toContain("Answer with the verdict line, then the summary.")
  expect(digestRequest({ ...base, answer: "digest" }).user).not.toContain(
    "Answer with",
  )
})
