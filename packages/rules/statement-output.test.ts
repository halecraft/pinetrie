import {
  type Attribution,
  type OutputEvent,
  type OutputFd,
  type Settled,
  type StatementIndex,
  statementIndex,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type Attributed,
  BASH_OUTPUT,
  bashOutputRecord,
  endedVerdict,
  type JoinEvent,
  type JoinState,
  joinStart,
  joinStep,
  joinVerdict,
  planVerdictChange,
  STATEMENT_FLOOR_LINES,
  type StatementLines,
  settledSplit,
  storedSplit,
  type Verdict,
} from "./statement-output.ts"

const ON: Attribution = { on: true }
const SETTLED = {} as Settled
const s = (n: number): StatementIndex => {
  const i = statementIndex(n)
  if (i === null) throw new Error(`no statement ${n}`)
  return i
}
/** Three statements, one a line. */
const LINES: readonly StatementLines[] = [
  { first: 1, last: 1 },
  { first: 2, last: 2 },
  { first: 3, last: 4 },
]

const chunk = (fd: OutputFd, bytes: number): JoinEvent => ({
  kind: "chunk",
  fd,
  bytes,
})
const notice = (event: OutputEvent): JoinEvent => ({ kind: "notice", event })
const signal = (n: number, line: number): JoinEvent =>
  notice({ kind: "statement", at: 0, statement: s(n), line })
const wrote = (n: number | null, fd: OutputFd, bytes: number): JoinEvent =>
  notice({
    kind: "output",
    fd,
    statement: n === null ? null : s(n),
    bytes,
  })
const DONE: JoinEvent = {
  kind: "done",
  flush: { kind: "settled", proof: SETTLED },
}

/** The events folded in order: the last state, and every range attributed. */
function fold(
  events: readonly JoinEvent[],
  start: JoinState = joinStart(LINES, ON),
): { readonly state: JoinState; readonly attributed: readonly Attributed[] } {
  let state = start
  const attributed: Attributed[] = []
  for (const e of events) {
    const step = joinStep(state, e)
    state = step.state
    attributed.push(...step.attributed)
  }
  return { state, attributed }
}

const why = (v: Verdict) => (v.kind === "undivided" ? v.why : null)
const bytesOf = (v: Verdict) =>
  v.kind === "split" ? v.split.statements : undefined

/** A three-statement call: 5 and 3 bytes of stdout from 1 and 3, 4 of stderr from 2. */
const CALL: readonly JoinEvent[] = [
  signal(1, 1),
  wrote(1, "stdout", 5),
  chunk("stdout", 5),
  signal(2, 2),
  chunk("stderr", 4),
  wrote(2, "stderr", 4),
  signal(3, 4),
  wrote(3, "stdout", 3),
  chunk("stdout", 3),
  DONE,
]

describe("joinVerdict", () => {
  test("a call whose every byte is attributed splits by statement", () => {
    const v = joinVerdict(fold(CALL).state)
    expect(bytesOf(v)).toEqual([
      { stdout: 5, stderr: 0 },
      { stdout: 0, stderr: 4 },
      { stdout: 3, stderr: 0 },
    ])
    expect(v.kind === "split" && settledSplit(v.split) !== null).toBe(true)
  })

  test("a split built one chunk at a time equals one built from whole chunks", () => {
    const bytewise = [
      signal(1, 1),
      wrote(1, "stdout", 5),
      ...Array.from({ length: 5 }, () => chunk("stdout", 1)),
      signal(2, 2),
      ...Array.from({ length: 4 }, () => chunk("stderr", 1)),
      wrote(2, "stderr", 2),
      wrote(2, "stderr", 2),
      signal(3, 4),
      chunk("stdout", 2),
      wrote(3, "stdout", 3),
      chunk("stdout", 1),
      DONE,
    ]
    expect(bytesOf(joinVerdict(fold(bytewise).state))).toEqual(
      bytesOf(joinVerdict(fold(CALL).state)),
    )
  })

  test("before any byte is attributed, the verdict waits", () => {
    expect(joinVerdict(fold([signal(1, 1), chunk("stdout", 5)]).state)).toEqual(
      { kind: "pending" },
    )
  })

  test("a running call's attributed bytes split, unsettled", () => {
    const v = joinVerdict(fold(CALL.slice(0, 3)).state)
    expect(v.kind === "split" && settledSplit(v.split)).toBe(null)
  })

  test("bytes read but never attributed leave the call undivided at its end", () => {
    expect(
      why(
        joinVerdict(
          fold([...CALL.slice(0, -1), chunk("stdout", 1), DONE]).state,
        ),
      ),
    ).toBe("count-mismatch")
  })

  test("bytes attributed but never read leave the call undivided at its end", () => {
    expect(
      why(
        joinVerdict(
          fold([...CALL.slice(0, -1), wrote(3, "stdout", 1), DONE]).state,
        ),
      ),
    ).toBe("count-mismatch")
  })

  test("a writer no statement of the run tagged makes the call undivided", () => {
    expect(why(joinVerdict(fold([wrote(null, "stdout", 1)]).state))).toBe(
      "unknown-statement",
    )
  })

  test("a writer of a statement past the command's last makes the call undivided", () => {
    expect(why(joinVerdict(fold([wrote(4, "stdout", 1)]).state))).toBe(
      "unknown-statement",
    )
  })

  test("a signal of a statement past the command's last makes the call undivided", () => {
    expect(why(joinVerdict(fold([signal(4, 4)]).state))).toBe(
      "unknown-statement",
    )
  })

  test("a signal whose line is outside its statement's makes the call undivided", () => {
    expect(why(joinVerdict(fold([signal(3, 2)]).state))).toBe(
      "line-outside-statement",
    )
    expect(why(joinVerdict(fold([signal(3, 5)]).state))).toBe(
      "line-outside-statement",
    )
  })

  test("a signal on either end line of its statement is within it", () => {
    expect(why(joinVerdict(fold([signal(3, 3), signal(3, 4)]).state))).toBe(
      null,
    )
  })

  test("a lane without an observer, or with attribution off, is undivided from the start", () => {
    expect(why(joinVerdict(joinStart(LINES, null)))).toBe("no-observer")
    expect(
      why(
        joinVerdict(
          joinStart(LINES, { on: false, why: "missing-hook", hook: "x" }),
        ),
      ),
    ).toBe("missing-hook")
    expect(
      why(
        joinVerdict(
          joinStart(LINES, { on: false, why: "other-version", version: "v" }),
        ),
      ),
    ).toBe("other-version")
  })

  test("over the cap, the call is undivided", () => {
    expect(
      why(joinVerdict(fold([...CALL.slice(0, 3), { kind: "over-cap" }]).state)),
    ).toBe("over-cap")
  })

  test("lost output makes the call undivided", () => {
    expect(
      why(
        joinVerdict(
          fold([...CALL.slice(0, 3), notice({ kind: "output-lost", count: 1 })])
            .state,
        ),
      ),
    ).toBe("output-lost")
  })

  test("over the cap and lost output win over a reason found before them", () => {
    const early = [signal(4, 4)]
    expect(why(joinVerdict(fold([...early, { kind: "over-cap" }]).state))).toBe(
      "over-cap",
    )
    expect(
      why(
        joinVerdict(
          fold([...early, notice({ kind: "output-lost", count: 1 })]).state,
        ),
      ),
    ).toBe("output-lost")
    expect(
      why(
        joinVerdict(
          fold(
            [{ kind: "over-cap" }, notice({ kind: "output-lost", count: 1 })],
            joinStart(LINES, null),
          ).state,
        ),
      ),
    ).toBe("over-cap")
  })

  test("the first of the other reasons stands", () => {
    expect(why(joinVerdict(fold([signal(3, 9), signal(5, 5)]).state))).toBe(
      "line-outside-statement",
    )
  })

  test("output not on pipes makes the call undivided before any byte, and stays the reason", () => {
    expect(why(joinVerdict(fold([{ kind: "no-pipes" }, ...CALL]).state))).toBe(
      "no-pipes",
    )
  })

  test("a call whose lane had no observer to flush is undivided for it", () => {
    const none: JoinEvent = { kind: "done", flush: { kind: "no-observer" } }
    expect(why(joinVerdict(fold([...CALL.slice(0, -1), none]).state))).toBe(
      "no-observer",
    )
  })

  test("a call whose flush failed is undivided, never split", () => {
    const failed: JoinEvent = { kind: "done", flush: { kind: "flush-failed" } }
    expect(why(joinVerdict(fold([...CALL.slice(0, -1), failed]).state))).toBe(
      "flush-failed",
    )
  })

  test("a settled call takes no more events", () => {
    const { state } = fold(CALL)
    expect(joinStep(state, chunk("stdout", 1)).state).toBe(state)
  })
})

describe("joinStep's attributed ranges", () => {
  test("bytes read before their attribution are held, then handed out", () => {
    const held = joinStep(joinStart(LINES, ON), chunk("stdout", 5))
    expect(held.attributed).toEqual([])
    expect(joinStep(held.state, wrote(1, "stdout", 5)).attributed).toEqual([
      { statement: s(1), fd: "stdout", from: 0, to: 5 },
    ])
  })

  test("attributions ahead of the bytes wait for them", () => {
    const ahead = fold([wrote(1, "stdout", 2), wrote(2, "stdout", 3)])
    expect(ahead.attributed).toEqual([])
    expect(joinStep(ahead.state, chunk("stdout", 4)).attributed).toEqual([
      { statement: s(1), fd: "stdout", from: 0, to: 2 },
      { statement: s(2), fd: "stdout", from: 2, to: 4 },
    ])
  })

  test("a statement's adjacent attributions come out as one range", () => {
    expect(
      fold([wrote(1, "stdout", 2), wrote(1, "stdout", 3), chunk("stdout", 5)])
        .attributed,
    ).toEqual([{ statement: s(1), fd: "stdout", from: 0, to: 5 }])
  })

  test("every byte read is in exactly one range, in order, per pipe", () => {
    const events: JoinEvent[] = []
    const writers = [1, 2, 1, 3, 3, 2]
    writers.forEach((n, i) => {
      events.push(wrote(n, i % 2 === 0 ? "stdout" : "stderr", i + 1))
      events.push(chunk(i % 2 === 0 ? "stderr" : "stdout", 1))
    })
    events.push(chunk("stdout", 100), chunk("stderr", 100))
    const { attributed } = fold(events)
    for (const fd of ["stdout", "stderr"] as const) {
      const ranges = attributed.filter(r => r.fd === fd)
      ranges.forEach((r, i) => {
        expect(r.from).toBe(i === 0 ? 0 : ranges[i - 1]?.to)
        expect(r.to).toBeGreaterThan(r.from)
      })
    }
    const total = attributed.reduce((n, r) => n + r.to - r.from, 0)
    expect(total).toBe(writers.reduce((n, _, i) => n + i + 1, 0))
  })

  test("an undivided call hands out nothing more", () => {
    const { state } = fold([wrote(null, "stdout", 1), wrote(1, "stdout", 1)])
    expect(joinStep(state, chunk("stdout", 2)).attributed).toEqual([])
  })
})

describe("planVerdictChange", () => {
  const split = joinVerdict(fold(CALL.slice(0, 3)).state)
  const pending: Verdict = { kind: "pending" }
  const undivided: Verdict = { kind: "undivided", why: "count-mismatch" }

  test("a split turned undivided closes the call's statement streams", () => {
    expect(planVerdictChange(split, undivided)).toEqual([
      { kind: "close-statements" },
    ])
  })

  test("any other change closes nothing", () => {
    expect(planVerdictChange(pending, undivided)).toEqual([])
    expect(planVerdictChange(pending, split)).toEqual([])
    expect(planVerdictChange(split, split)).toEqual([])
    expect(planVerdictChange(undivided, undivided)).toEqual([])
  })
})

describe("storedSplit", () => {
  const view = (n: number, prefix = "l") => ({
    text: Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n"),
    truncated: false,
    stderr: [],
  })
  const lineCount = (t: string) => (t === "" ? 0 : t.split("\n").length)

  test("within the limits, every statement keeps its whole view", () => {
    expect(
      storedSplit([view(2), view(3)], { maxLines: 10, maxBytes: 1000 }),
    ).toEqual([
      { text: "l1\nl2", truncated: false, stderr: [] },
      { text: "l1\nl2\nl3", truncated: false, stderr: [] },
    ])
  })

  test("over the line limit, the last statement fills first and the earlier keep their floor", () => {
    const stored = storedSplit([view(10, "a"), view(10, "b"), view(10, "c")], {
      maxLines: 12,
      maxBytes: 1000,
    })
    expect(stored.map(t => lineCount(t.text))).toEqual([
      STATEMENT_FLOOR_LINES,
      STATEMENT_FLOOR_LINES,
      12 - 2 * STATEMENT_FLOOR_LINES,
    ])
    expect(stored[0]?.text.split("\n").at(-1)).toBe("a10")
    expect(stored.map(t => t.truncated)).toEqual([true, true, true])
  })

  test("the whole record keeps within the byte limit, each line with its newline", () => {
    const stored = storedSplit([view(50), view(50)], {
      maxLines: 1000,
      maxBytes: 60,
    })
    const bytes = stored.reduce(
      (n, t) => n + t.text.split("\n").reduce((m, l) => m + l.length + 1, 0),
      0,
    )
    expect(bytes).toBeLessThanOrEqual(60)
    expect(stored.every(t => lineCount(t.text) >= 1)).toBe(true)
  })

  test("a last line too long for what is left keeps its tail, whole characters only", () => {
    // 6 bytes, less its newline, leave 5: one "€", and no part of the next.
    const [only] = storedSplit(
      [{ text: "ab€€", truncated: false, stderr: [] }],
      { maxLines: 10, maxBytes: 6 },
    )
    expect(only).toEqual({ text: "€", truncated: true, stderr: [] })
  })

  test("a statement that printed nothing stores nothing", () => {
    expect(
      storedSplit([view(0), view(1)], { maxLines: 5, maxBytes: 100 }),
    ).toEqual([
      { text: "", truncated: false, stderr: [] },
      { text: "l1", truncated: false, stderr: [] },
    ])
  })

  test("a view its capture cut is stored as cut", () => {
    expect(
      storedSplit([{ text: "x", truncated: true, stderr: [] }], {
        maxLines: 5,
        maxBytes: 100,
      }),
    ).toEqual([{ text: "x", truncated: true, stderr: [] }])
  })

  test("a statement cut to its last lines keeps its stderr on the same characters", () => {
    // "a1\na2\nE3\na4": stderr is "E3", at 6..8.
    const text = "a1\na2\nE3\na4"
    const [only] = storedSplit(
      [{ text, truncated: false, stderr: [{ from: 6, to: 8 }] }],
      { maxLines: 2, maxBytes: 100 },
    )
    const kept = only?.text ?? ""
    expect(kept).toBe("E3\na4")
    expect(only?.stderr.map(r => kept.slice(r.from, r.to))).toEqual(["E3"])
  })

  test("a stderr range wholly in the cut part is dropped", () => {
    const [only] = storedSplit(
      [{ text: "E1\na2", truncated: false, stderr: [{ from: 0, to: 3 }] }],
      { maxLines: 1, maxBytes: 100 },
    )
    expect(only).toEqual({ text: "a2", truncated: true, stderr: [] })
  })
})

describe("the stored record", () => {
  // Statement 2 prints nothing.
  const quiet = [
    signal(1, 1),
    wrote(1, "stdout", 5),
    chunk("stdout", 5),
    signal(2, 2),
    signal(3, 4),
    wrote(3, "stdout", 3),
    chunk("stdout", 3),
    DONE,
  ]
  const LIMITS = { maxLines: 100, maxBytes: 1000 }
  const ended = (events: readonly JoinEvent[]) => {
    const verdict = endedVerdict(fold(events).state)
    if (verdict === null) throw new Error("the call has not ended")
    return verdict
  }
  const roundTrip = (record: ReturnType<typeof bashOutputRecord>) =>
    BASH_OUTPUT.decode(BASH_OUTPUT.encode(record), BASH_OUTPUT.keyOf(record))

  test("asks for the views of statements that printed, and round-trips", () => {
    const asked: number[] = []
    const record = bashOutputRecord(
      "call-1",
      ended(quiet),
      n => {
        asked.push(n)
        return {
          text: `out ${n}`,
          truncated: false,
          stderr: [{ from: 0, to: 3 }],
        }
      },
      [{ from: 2, to: 4 }],
      LIMITS,
    )
    expect(asked).toEqual([1, 3])
    expect(
      record.verdict.kind === "split" ? record.verdict.statements[1] : null,
    ).toEqual({ text: "", truncated: false, stderr: [] })
    expect(roundTrip(record)).toEqual(record)
  })

  test("an undivided call stores its reason, and round-trips", () => {
    const record = bashOutputRecord(
      "call-2",
      ended([{ kind: "no-pipes" }, chunk("stdout", 3), DONE]),
      () => {
        throw new Error("an undivided call asks for no view")
      },
      [],
      LIMITS,
    )
    expect(record.verdict).toEqual({ kind: "undivided", why: "no-pipes" })
    expect(roundTrip(record)).toEqual(record)
  })

  test("a call that has not ended has no verdict to store", () => {
    expect(endedVerdict(fold(quiet.slice(0, -1)).state)).toBe(null)
  })
})
