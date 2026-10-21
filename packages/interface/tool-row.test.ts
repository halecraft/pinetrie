import { type ImageRef, isSha256 } from "@pinetrie/core"
import { streamId, type ToolCall, type ToolResult } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import {
  type CommandLine,
  callMark,
  callSplits,
  callStatus,
  EARLIER_LINES,
  headLines,
  LINE_LENGTH,
  liveRowSplit,
  moreWords,
  NO_MEMORY,
  type RowSplit,
  type Run,
  rowLead,
  rowSummary,
  rowView,
  runningFor,
  SHOWN,
  storedRowSplit,
  tailLines,
  toolBody,
  wholeOutput,
} from "./tool-row.ts"

const text = (runs: readonly Run[] | undefined) =>
  runs?.map(r => r.text).join("")
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
    const tail = tailLines(plain(numbered(8)))
    expect(text(tail.runs)).toBe("line 4\nline 5\nline 6\nline 7\nline 8")
    expect(tail.hidden).toBe(3)
  })

  test("a final line break starts no line, and an empty text has none", () => {
    expect(tailLines(plain(`${numbered(5)}\n`))).toMatchObject({ hidden: 0 })
    expect(text(tailLines(plain(`${numbered(6)}\n`)).runs)).toBe(
      "line 2\nline 3\nline 4\nline 5\nline 6",
    )
    expect(tailLines(plain(""))).toEqual({ runs: [], hidden: 0, cut: false })
  })

  test("pi's status after a blank line is the tail's end", () => {
    const failed = `${numbered(10)}\n\nCommand exited with code 1`
    expect(text(tailLines(plain(failed)).runs)).toBe(
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
  expect(wholeOutput("short")).toBe("short")
  const long = `${"a".repeat(10)}${"b".repeat(SHOWN)}`
  expect(wholeOutput(long)).toBe(
    `… 10 earlier characters\n${"b".repeat(SHOWN)}`,
  )
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
    const closed = rowView(summary, COMMAND, output, TEXT, false, null)
    expect(lineText(closed.command)).toBe(numbered(5))
    expect(closed.body).toEqual({
      kind: "text",
      text: "line 296\nline 297\nline 298\nline 299\nline 300",
    })
    expect(closed.more).toBe("+4 lines · +295 lines of output")
    const open = rowView(summary, COMMAND, output, TEXT, true, null)
    expect(lineText(open.command)).toBe(numbered(9))
    expect(open.body).toEqual({ kind: "text", text: output })
    expect(open.more).toBe("less")
  })

  test("a short command with short output hides nothing, and has no toggle", () => {
    const view = rowView(
      rowSummary(call("echo hi")),
      COMMAND,
      "hi\n",
      TEXT,
      false,
      null,
    )
    expect(lineText(view.command)).toBe("echo hi")
    expect(view.body).toEqual({ kind: "text", text: "hi" })
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
      rowView(summary, COMMAND, "", TEXT, open, null)
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
    expect(rowView(summary, COMMAND, "", tall, false, null)).toMatchObject({
      body: { kind: "images", thumb: true },
      more: "full size",
    })
    expect(rowView(summary, COMMAND, "", tall, true, null)).toMatchObject({
      body: { kind: "images", thumb: false },
      more: "less",
    })
    const short = toolBody(result([image(100)]))
    expect(rowView(summary, COMMAND, "", short, false, null)).toMatchObject({
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
      "ok\n",
      TEXT,
      false,
      null,
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
    const view = rowView(summary, COMMAND, "ok\n", TEXT, false, null)
    expect(view.head).toBeNull()
    expect(view.caption).toBe("Run the tests")
    expect(lineText(view.command)).toBe("npx vitest run")
  })
  test("a call with no intent reads as before", () => {
    const summary = rowSummary(call("echo hi"))
    expect(rowLead(summary, "story")).toEqual({ kind: "command" })
    expect(rowView(summary, COMMAND, "hi\n", TEXT, false, null)).toMatchObject({
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
    expect(rowView(summary, lead, "ok\n", TEXT, false, null).more).toBe(
      "command",
    )
    expect(rowView(summary, lead, numbered(300), TEXT, false, null).more).toBe(
      "command · +295 lines of output",
    )
    const open = rowView(summary, lead, "ok\n", TEXT, true, null)
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
    texts.map(text => ({ text, truncated: false }))
  const outputs = (lines: readonly CommandLine[]) =>
    lines.map(l => [text(l.runs), l.outputs])
  const command = "echo a\nif true\nthen echo b\nfi\ntrue"

  test("each statement's output is under the line it ends on, and the body has none", () => {
    const view = rowView(
      rowSummary(bash(command)),
      COMMAND,
      "a\nb\n",
      TEXT,
      true,
      out("a\n", "b\n", ""),
    )
    expect(outputs(view.command)).toEqual([
      ["echo a", ["a\n"]],
      ["if true", []],
      ["then echo b", []],
      ["fi", ["b\n"]],
      ["true", []],
    ])
    expect(view.body).toEqual({ kind: "text", text: "" })
  })

  test("statements sharing a line have their outputs under it, in order", () => {
    const view = rowView(
      rowSummary(bash("echo a; echo b")),
      COMMAND,
      "a\nb\n",
      TEXT,
      true,
      out("a\n", "b\n"),
    )
    expect(view.command[0]?.outputs).toEqual(["a\n", "b\n"])
  })

  test("the summary of a split call is as any call's", () => {
    const summary = rowSummary(bash(command))
    expect(
      rowView(summary, COMMAND, "a\nb\n", TEXT, false, out("a\n", "b\n", "")),
    ).toEqual(rowView(summary, COMMAND, "a\nb\n", TEXT, false, null))
  })

  test("a split of another count of statements is not drawn", () => {
    const summary = rowSummary(bash(command))
    expect(rowView(summary, COMMAND, "a\n", TEXT, true, out("a\n"))).toEqual(
      rowView(summary, COMMAND, "a\n", TEXT, true, null),
    )
  })

  test("a statement's output whose start was left out says so above it", () => {
    const view = rowView(
      rowSummary(bash("echo a")),
      COMMAND,
      "a\n",
      TEXT,
      true,
      [{ text: "a\n", truncated: true }],
    )
    expect(view.command[0]?.outputs).toEqual([`${EARLIER_LINES}\na\n`])
  })

  test("a running call splits once a statement has printed, for its command's statements only", () => {
    expect(liveRowSplit({}, 3)).toBe(null)
    expect(liveRowSplit({ 4: "x" }, 3)).toBe(null)
    expect(liveRowSplit({ 2: "b" }, 3)).toEqual(out("", "b", ""))
  })

  test("a stored split reads its record's statements, and a message takes its own calls'", () => {
    const record = {
      call: "c",
      statements: [{ text: "a", truncated: true }],
    } as unknown as Parameters<typeof storedRowSplit>[0]
    expect(storedRowSplit(record)).toEqual([{ text: "a", truncated: true }])
    expect(
      callSplits(
        [bash("x")],
        new Map([
          ["c", record],
          ["d", record],
        ]),
      ),
    ).toEqual({ c: record })
  })
})
