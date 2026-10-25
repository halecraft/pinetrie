import { type ImageRef, isSha256 } from "@pinetrie/core"
import type { BashOutputRecord } from "@pinetrie/rules"
import { streamId, type ToolCall, type ToolResult } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  type CommandLine,
  callBashOutputs,
  callMark,
  callStatus,
  EARLIER_LINES,
  headLines,
  LINE_LENGTH,
  liveRowSplit,
  moreWords,
  NO_MEMORY,
  type OutputRun,
  outputRuns,
  plainRowOutput,
  type RowSplit,
  type Run,
  rowLead,
  rowOutput,
  rowSummary,
  rowView,
  runningFor,
  SHOWN,
  tailLines,
  toolBody,
  wholeOutput,
} from "./tool-row.ts"

const text = (runs: readonly (Run | OutputRun)[] | undefined) =>
  runs?.map(r => r.text).join("")
const output = (t: string): OutputRun[] => [{ text: t, stderr: false }]
/** A text body, as `rowView` draws it, from its runs' text. */
const bodyText = (body: { kind: string; runs?: readonly OutputRun[] }) =>
  body.kind === "text" ? text(body.runs ?? []) : null
const lineText = (lines: readonly CommandLine[]) =>
  lines.map(l => text(l.runs)).join("\n")
const plain = (t: string): Run[] => [{ text: t, role: "plain" }]
const numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")

test("a row never drawn before starts in its summary, unringed", () => {
  expect(NO_MEMORY).toEqual({ revealed: false, open: false })
})

const sha = "a".repeat(64)
if (!isSha256(sha)) throw new Error("not a sha")
const image = (height: number): ImageRef => ({
  sha256: sha,
  mimeType: "image/png",
  width: 40,
  height,
})
const IMAGE = image(30)
const result = (images: readonly ImageRef[]): ToolResult => ({
  text: "Read image file [image/png]",
  isError: false,
  images,
})

test("a result with an image shows the image, its caption as the note", () => {
  expect(toolBody(result([IMAGE]))).toEqual({
    kind: "images",
    images: [IMAGE],
    note: "Read image file [image/png]",
  })
})

test("a result without an image, or no result yet, shows text", () => {
  expect(toolBody(result([]))).toEqual({ kind: "text" })
  expect(toolBody(undefined)).toEqual({ kind: "text" })
})

test("a call's status: running without a result, failed by its result's error; a running one has no mark", () => {
  const result = (isError: boolean): ToolResult => ({
    text: "",
    isError,
    images: [],
  })
  expect(callStatus(undefined)).toBe("pending")
  expect(callStatus(result(true))).toBe("error")
  expect(callStatus(result(false))).toBe("ok")
  expect(callMark("pending")).toBeUndefined()
  expect(callMark("error")).toBe("✗")
  expect(callMark("ok")).toBe("✓")
})

describe("headLines and tailLines", () => {
  test("a text of five lines or fewer is shown whole", () => {
    expect(headLines(plain(numbered(3)))).toEqual({
      runs: plain(numbered(3)),
      hidden: 0,
      cut: false,
    })
  })

  test("the head is the first five lines, the tail the last five, and each counts the rest", () => {
    const head = headLines(plain(numbered(8)))
    expect(text(head.runs)).toBe(numbered(5))
    expect(head.hidden).toBe(3)
    const tail = tailLines(output(numbered(8)))
    expect(text(tail.runs)).toBe("line 4\nline 5\nline 6\nline 7\nline 8")
    expect(tail.hidden).toBe(3)
  })

  test("a final line break starts no line, and an empty text has none", () => {
    expect(tailLines(output(`${numbered(5)}\n`))).toMatchObject({ hidden: 0 })
    expect(text(tailLines(output(`${numbered(6)}\n`)).runs)).toBe(
      "line 2\nline 3\nline 4\nline 5\nline 6",
    )
    expect(tailLines(output(""))).toEqual({ runs: [], hidden: 0, cut: false })
  })

  test("pi's status after a blank line is the tail's end", () => {
    const failed = `${numbered(10)}\n\nCommand exited with code 1`
    expect(text(tailLines(output(failed)).runs)).toBe(
      "line 8\nline 9\nline 10\n\nCommand exited with code 1",
    )
  })

  test("a run across a line break is split, and both parts keep its role", () => {
    const runs: Run[] = [
      { text: "cat <<'EOF'", role: "command" },
      { text: "\na\nb\nc\nd\ne\nEOF", role: "string" },
    ]
    const head = headLines(runs)
    expect(head.runs).toEqual([
      { text: "cat <<'EOF'", role: "command" },
      { text: "\n", role: "plain" },
      { text: "a", role: "string" },
      { text: "\n", role: "plain" },
      { text: "b", role: "string" },
      { text: "\n", role: "plain" },
      { text: "c", role: "string" },
      { text: "\n", role: "plain" },
      { text: "d", role: "string" },
    ])
    expect(head.hidden).toBe(2)
  })

  test("a long line is cut at LINE_LENGTH, with …", () => {
    const head = headLines(plain(`${"x".repeat(400)}\nshort`))
    expect(text(head.runs)).toBe(`${"x".repeat(LINE_LENGTH)}…\nshort`)
    expect(head.cut).toBe(true)
  })
})

test("the detail's output is whole, or its end after a count of what it leaves out", () => {
  expect(text(wholeOutput(output("short")))).toBe("short")
  const long = `${"a".repeat(10)}${"b".repeat(SHOWN)}`
  expect(text(wholeOutput(output(long)))).toBe(
    `… 10 earlier characters\n${"b".repeat(SHOWN)}`,
  )
})

test("the detail's output cut through a stderr run keeps the mark on what is left", () => {
  const cut = wholeOutput(
    // 12 of stderr, then stdout: the cut drops the first 10.
    outputRuns(`${"e".repeat(12)}${"o".repeat(SHOWN - 2)}`, [
      { from: 0, to: 12 },
    ]),
  )
  expect(cut.filter(r => r.stderr).map(r => r.text)).toEqual(["ee"])
  expect(cut[0]).toEqual({ text: "… 10 earlier characters\n", stderr: false })
})

test("a result's notes after its output are never stderr", () => {
  const runs = outputRuns("err\n\nCommand exited with code 1", [
    { from: 0, to: 4 },
    { from: 40, to: 50 },
  ])
  expect(runs).toEqual([
    { text: "err\n", stderr: true },
    { text: "\nCommand exited with code 1", stderr: false },
  ])
})

describe("moreWords", () => {
  const none = { command: 0, output: 0, cut: false, image: false }
  test.each<[Partial<typeof none>, string | undefined]>([
    [{ command: 3, output: 335 }, "+3 lines · +335 lines of output"],
    [{ command: 1 }, "+1 line"],
    [{ output: 2 }, "+2 lines of output"],
    [{ cut: true }, "whole lines"],
    [{ cut: true, output: 2 }, "+2 lines of output"],
    [{ image: true }, "full size"],
    [{}, undefined],
  ])("a summary hiding %o says %s", (hidden, words) => {
    expect(moreWords({ ...none, ...hidden }, false)).toBe(words)
  })

  test("the detail says less, and a row hiding nothing has no toggle", () => {
    expect(moreWords({ ...none, command: 3 }, true)).toBe("less")
    expect(moreWords(none, true)).toBeUndefined()
  })
})

describe("rowView", () => {
  const call = (subject: string): ToolCall => ({
    id: "c",
    name: "bash",
    subject,
  })
  const TEXT = { kind: "text" } as const
  const COMMAND = { kind: "command" } as const

  test("the summary shows the command's head and the output's tail; the detail both whole", () => {
    const summary = rowSummary(call(numbered(9)))
    const output = numbered(300)
    const closed = rowView(
      summary,
      COMMAND,
      plainRowOutput(output),
      TEXT,
      false,
    )
    expect(lineText(closed.command)).toBe(numbered(5))
    expect(bodyText(closed.body)).toBe(
      "line 296\nline 297\nline 298\nline 299\nline 300",
    )
    expect(closed.more).toBe("+4 lines · +295 lines of output")
    const open = rowView(summary, COMMAND, plainRowOutput(output), TEXT, true)
    expect(lineText(open.command)).toBe(numbered(9))
    expect(bodyText(open.body)).toBe(output)
    expect(open.more).toBe("less")
  })

  test("a short command with short output hides nothing, and has no toggle", () => {
    const view = rowView(
      rowSummary(call("echo hi")),
      COMMAND,
      plainRowOutput("hi\n"),
      TEXT,
      false,
    )
    expect(lineText(view.command)).toBe("echo hi")
    expect(bodyText(view.body)).toBe("hi")
    expect(view.more).toBeUndefined()
  })

  test("a line beginning a top-level statement is set apart, in the summary and the detail", () => {
    const command = [
      "cd /tmp/copy &&",
      "  jj log -r x |",
      "    head -2",
      "ls packages",
      "pnpm test > /tmp/log 2>&1",
      'rg -n "FAIL" /tmp/log',
    ].join("\n")
    const summary = rowSummary(call(command))
    const apart = (open: boolean) =>
      rowView(summary, COMMAND, plainRowOutput(""), TEXT, open)
        .command.filter(l => l.startsStatement)
        .map(l => text(l.runs))
    expect(apart(false)).toEqual(["ls packages", "pnpm test > /tmp/log 2>&1"])
    expect(apart(true)).toEqual([
      "ls packages",
      "pnpm test > /tmp/log 2>&1",
      'rg -n "FAIL" /tmp/log',
    ])
  })

  test("a tall image is a thumbnail in the summary, with full size; a short one is drawn whole, with no toggle", () => {
    const summary = rowSummary({ id: "c", name: "read", subject: "a.png" })
    const tall = toolBody(result([image(400)]))
    expect(
      rowView(summary, COMMAND, plainRowOutput(""), tall, false),
    ).toMatchObject({
      body: { kind: "images", thumb: true },
      more: "full size",
    })
    expect(
      rowView(summary, COMMAND, plainRowOutput(""), tall, true),
    ).toMatchObject({
      body: { kind: "images", thumb: false },
      more: "less",
    })
    const short = toolBody(result([image(100)]))
    expect(
      rowView(summary, COMMAND, plainRowOutput(""), short, false),
    ).toMatchObject({
      body: { kind: "images", thumb: false },
      more: undefined,
    })
  })
})

describe("rowSummary", () => {
  const call = (name: string, subject?: string): ToolCall =>
    subject === undefined ? { id: "c", name } : { id: "c", name, subject }

  test("a long chain is tagged ran, highlighted, and laid out a step a line", () => {
    const chain =
      "mkdir -p /tmp/wc && cd /tmp/wc && git init -q && git commit -m init && ls -la && pnpm test"
    const s = rowSummary(call("bash", chain))
    expect(s.tag).toBe("ran")
    expect(s.whole.filter(r => r.role === "command").length).toBe(6)
    expect(text(s.whole)?.split("\n")).toEqual([
      "mkdir -p /tmp/wc &&",
      "  cd /tmp/wc &&",
      "  git init -q &&",
      "  git commit -m init &&",
      "  ls -la &&",
      "  pnpm test",
    ])
  })

  test("a short command is as written", () => {
    expect(text(rowSummary(call("bash", "pnpm test")).whole)).toBe("pnpm test")
  })

  test("a path is one plain run", () => {
    expect(rowSummary(call("read", "a.ts"))).toEqual({
      tag: "read",
      whole: [{ text: "a.ts", role: "plain" }],
      starts: [],
      statements: [],
    })
  })

  test("a call with no subject is its word, untagged; an unknown tool is tagged with its name", () => {
    expect(rowSummary(call("split_proposed_changes"))).toEqual({
      tag: undefined,
      whole: [{ text: "split", role: "plain" }],
      starts: [],
      statements: [],
    })
    expect(rowSummary(call("mystery", "x")).tag).toBe("mystery")
  })
})

test("a running call's time counts from its stream's start, and next changes at its next whole second", () => {
  const start = Date.UTC(2026, 9, 9, 12, 0, 0, 0)
  const hex = start.toString(16).padStart(12, "0")
  const stream = streamId(
    `${hex.slice(0, 8)}-${hex.slice(8)}-7abc-8def-0123456789ab`,
  )
  expect(runningFor(stream, start + 65_250)).toEqual({
    words: "1m 05s",
    next: 750,
  })
  // A browser whose clock is behind the host's: no time before the start.
  expect(runningFor(stream, start - 2_500)).toEqual({ words: "0s", next: 1000 })
  expect(runningFor(streamId("id-0001"), start)).toBeUndefined()
})

describe("rowLead", () => {
  const call = (subject: string): ToolCall => ({
    id: "c",
    name: "bash",
    subject,
  })
  const TEXT = { kind: "text" } as const
  const COMMAND = { kind: "command" } as const
  test("story leads a row with its intent", () => {
    const summary = rowSummary({
      ...call("npx vitest run"),
      intent: "Run the tests",
    })
    expect(rowLead(summary, "story")).toEqual({
      kind: "intent",
      intent: "Run the tests",
    })
    expect(rowLead(summary, "raw")).toEqual({ kind: "command" })
    expect(rowLead(summary, "outline")).toEqual({ kind: "command" })
    const view = rowView(
      summary,
      rowLead(summary, "story"),
      plainRowOutput("ok\n"),
      TEXT,
      false,
    )
    expect(view).toMatchObject({
      head: "Run the tests",
      caption: null,
      command: [],
    })
  })
  test("raw shows the command, its intent a caption under it", () => {
    const summary = rowSummary({
      ...call("npx vitest run"),
      intent: "Run the tests",
    })
    const view = rowView(summary, COMMAND, plainRowOutput("ok\n"), TEXT, false)
    expect(view.head).toBeNull()
    expect(view.caption).toBe("Run the tests")
    expect(lineText(view.command)).toBe("npx vitest run")
  })
  test("a call with no intent reads as before", () => {
    const summary = rowSummary(call("echo hi"))
    expect(rowLead(summary, "story")).toEqual({ kind: "command" })
    expect(
      rowView(summary, COMMAND, plainRowOutput("hi\n"), TEXT, false),
    ).toMatchObject({
      head: null,
      caption: null,
    })
  })
  test("the toggle names the hidden command", () => {
    const summary = rowSummary({
      ...call("npx vitest run"),
      intent: "Run the tests",
    })
    const lead = rowLead(summary, "story")
    expect(
      rowView(summary, lead, plainRowOutput("ok\n"), TEXT, false).more,
    ).toBe("command")
    expect(
      rowView(summary, lead, plainRowOutput(numbered(300)), TEXT, false).more,
    ).toBe("command · +295 lines of output")
    const open = rowView(summary, lead, plainRowOutput("ok\n"), TEXT, true)
    expect(lineText(open.command)).toBe("npx vitest run")
    expect(open.more).toBe("less")
  })
})

describe("a row's detail by statement", () => {
  const bash = (subject: string): ToolCall => ({
    id: "c",
    name: "bash",
    subject,
  })
  const TEXT = { kind: "text" } as const
  const COMMAND = { kind: "command" } as const
  const out = (...texts: string[]): RowSplit =>
    texts.map(text => ({ text, truncated: false, stderr: [] }))
  const outputs = (lines: readonly CommandLine[]) =>
    lines.map(l => [text(l.runs), l.outputs.map(o => text(o))])
  const command = "echo a\nif true\nthen echo b\nfi\ntrue"

  test("each statement's output is under the line it ends on, and the body has none", () => {
    const view = rowView(
      rowSummary(bash(command)),
      COMMAND,
      { ...plainRowOutput("a\nb\n"), split: out("a\n", "b\n", "") },
      TEXT,
      true,
    )
    expect(outputs(view.command)).toEqual([
      ["echo a", ["a\n"]],
      ["if true", []],
      ["then echo b", []],
      ["fi", ["b\n"]],
      ["true", []],
    ])
    expect(bodyText(view.body)).toBe("")
  })

  test("statements sharing a line have their outputs under it, in order", () => {
    const view = rowView(
      rowSummary(bash("echo a; echo b")),
      COMMAND,
      { ...plainRowOutput("a\nb\n"), split: out("a\n", "b\n") },
      TEXT,
      true,
    )
    expect(view.command[0]?.outputs.map(o => text(o))).toEqual(["a\n", "b\n"])
  })

  test("the summary of a split call is as any call's", () => {
    const summary = rowSummary(bash(command))
    expect(
      rowView(
        summary,
        COMMAND,
        { ...plainRowOutput("a\nb\n"), split: out("a\n", "b\n", "") },
        TEXT,
        false,
      ),
    ).toEqual(rowView(summary, COMMAND, plainRowOutput("a\nb\n"), TEXT, false))
  })

  test("a split of another count of statements is not drawn", () => {
    const summary = rowSummary(bash(command))
    expect(
      rowView(
        summary,
        COMMAND,
        { ...plainRowOutput("a\n"), split: out("a\n") },
        TEXT,
        true,
      ),
    ).toEqual(rowView(summary, COMMAND, plainRowOutput("a\n"), TEXT, true))
  })

  test("a statement's output whose start was left out says so above it", () => {
    const view = rowView(
      rowSummary(bash("echo a; echo b")),
      COMMAND,
      {
        ...plainRowOutput("a\nb\n"),
        split: [
          { text: "a\n", truncated: true, stderr: [] },
          { text: "b\n", truncated: false, stderr: [] },
        ],
      },
      TEXT,
      true,
    )
    expect(view.command[0]?.outputs.map(o => text(o))).toEqual([
      `${EARLIER_LINES}\na\n`,
      "b\n",
    ])
  })

  test("a statement's stderr is marked under its line", () => {
    const view = rowView(
      rowSummary(bash("echo a; echo e >&2")),
      COMMAND,
      {
        ...plainRowOutput("a\ne\n"),
        split: [
          { text: "a\n", truncated: false, stderr: [] },
          { text: "e\n", truncated: false, stderr: [{ from: 0, to: 2 }] },
        ],
      },
      TEXT,
      true,
    )
    expect(view.command[0]?.outputs).toEqual([
      [{ text: "a\n", stderr: false }],
      [{ text: "e\n", stderr: true }],
    ])
  })

  test("a single statement is never split: its output is the body's", () => {
    const view = rowView(
      rowSummary(bash("echo a")),
      COMMAND,
      { ...plainRowOutput("a\n"), split: out("a\n") },
      TEXT,
      true,
    )
    expect(view.command[0]?.outputs).toEqual([])
    expect(bodyText(view.body)).toBe("a\n")
  })

  test("a running call splits once a statement has printed, for its command's statements only", () => {
    expect(liveRowSplit({}, 3)).toBe(null)
    expect(liveRowSplit({ 4: "x" }, 3)).toBe(null)
    expect(liveRowSplit({ 2: "b" }, 3)).toEqual(out("", "b", ""))
  })

  test("a message takes its own calls' records", () => {
    const record = { call: "c" } as unknown as BashOutputRecord
    expect(
      callBashOutputs(
        [bash("x")],
        new Map([
          ["c", record],
          ["d", record],
        ]),
      ),
    ).toEqual({ c: record })
  })
})

describe("a row's output", () => {
  const bash = (subject: string, resultText?: string): ToolCall => ({
    id: "c",
    name: "bash",
    subject,
    ...(resultText === undefined
      ? {}
      : { result: { text: resultText, isError: false, images: [] } }),
  })
  const record = (verdict: BashOutputRecord["verdict"]) =>
    ({
      call: "c",
      verdict,
      stderr: [{ from: 0, to: 2 }],
    }) as unknown as BashOutputRecord
  const SPLIT = record({
    kind: "split",
    statements: [
      { text: "a\n", truncated: false, stderr: [] },
      { text: "b\n", truncated: false, stderr: [] },
    ],
  })
  const UNDIVIDED = record({ kind: "undivided", why: "no-pipes" })
  const TEXT = { kind: "text" } as const
  const COMMAND = { kind: "command" } as const

  test("once a call has its result, its stored record; before, its live streams", () => {
    expect(
      rowOutput(bash("echo a; echo b", "a\nb\n"), "", SPLIT, { 1: "x" }, 2),
    ).toEqual({
      text: "a\nb\n",
      stderr: [{ from: 0, to: 2 }],
      split: SPLIT.verdict.kind === "split" ? SPLIT.verdict.statements : null,
      whyUndivided: null,
    })
    expect(
      rowOutput(bash("echo a; echo b"), "a\n", SPLIT, { 1: "a\n" }, 2),
    ).toEqual({
      text: "a\n",
      stderr: [],
      split: [
        { text: "a\n", truncated: false, stderr: [] },
        { text: "", truncated: false, stderr: [] },
      ],
      whyUndivided: null,
    })
    expect(
      rowOutput(bash("echo a; echo b", "a\nb\n"), "", UNDIVIDED, {}, 2),
    ).toMatchObject({ split: null, whyUndivided: "no-pipes" })
  })

  test("the open detail of an undivided command of statements says why, and nothing else does", () => {
    const two = rowSummary(bash("echo a; echo b"))
    const why = {
      ...plainRowOutput("a\nb\n"),
      whyUndivided: "no-pipes" as const,
    }
    expect(rowView(two, COMMAND, why, TEXT, true).undividedNote).toBe(
      "Not split by statement: its output wasn't a pipe.",
    )
    expect(rowView(two, COMMAND, why, TEXT, false).undividedNote).toBeNull()
    expect(
      rowView(rowSummary(bash("echo a")), COMMAND, why, TEXT, true)
        .undividedNote,
    ).toBeNull()
    expect(
      rowView(two, COMMAND, plainRowOutput("a\nb\n"), TEXT, true).undividedNote,
    ).toBeNull()
  })

  test("the summary is the same whether or not the call says why it is undivided", () => {
    const two = rowSummary(bash("echo a; echo b"))
    const plainView = rowView(
      two,
      COMMAND,
      plainRowOutput("a\nb\n"),
      TEXT,
      false,
    )
    const why = {
      ...plainRowOutput("a\nb\n"),
      whyUndivided: "count-mismatch" as const,
    }
    expect(rowView(two, COMMAND, why, TEXT, false)).toEqual(plainView)
  })

  test("the body marks its stderr", () => {
    const view = rowView(
      rowSummary(bash("echo e >&2; echo o")),
      COMMAND,
      { ...plainRowOutput("e\no\n"), stderr: [{ from: 0, to: 2 }] },
      TEXT,
      true,
    )
    expect(view.body).toEqual({
      kind: "text",
      runs: [
        { text: "e\n", stderr: true },
        { text: "o\n", stderr: false },
      ],
    })
  })
})
