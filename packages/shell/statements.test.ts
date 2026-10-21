import { parse } from "unbash"
import { describe, expect, test } from "vitest"
import { commandStatements, statementsCommand } from "./fixtures.ts"
import { readShell } from "./read.ts"
import { statementLines, statementSpans } from "./statements.ts"

const starts = (text: string) => statementLines(text, parse(text))

describe("statementLines", () => {
  test("a statement starting its own line begins one, past the first", () => {
    const agents = [
      "cd /tmp/basecopy &&",
      "  jj log -r x |",
      "    head -2",
      "ls packages/web-core 2>&1 | head -1",
      "PINETRIE_SCENARIO=page pnpm run e2e:browser > /tmp/e2e.log 2>&1",
      'rg -n "FAIL|ERROR" /tmp/e2e.log | head',
    ].join("\n")
    expect(starts(agents)).toEqual([3, 4, 5])
  })

  test("statements sharing a line begin none between them", () => {
    expect(starts("a\nb; c\nd")).toEqual([1, 2])
  })

  test("the comment lines above a statement begin it", () => {
    expect(starts("a\n# check the copy\n# again\nb")).toEqual([1])
  })

  test("a statement after a blank line begins none", () => {
    expect(starts("a\n\nb\n\n# why\nc")).toEqual([])
  })

  test("a heredoc's body is its statement's, though a line of it looks like a comment", () => {
    expect(starts("cat <<EOF > f\n# body\nEOF\necho done")).toEqual([3])
  })

  test("a line of the statement before, though it looks like a comment, is not lifted over", () => {
    expect(starts('echo "a\n# b"\nc')).toEqual([2])
  })
})

test("a laid-out command's starts are its layout's lines", () => {
  const { laidOut } = readShell(
    "mkdir -p /tmp/wc && cd /tmp/wc && git init -q && git commit -m init && ls -la; echo done",
    56,
  )
  const lines = (laidOut?.spans ?? [])
    .map(s => s.text)
    .join("")
    .split("\n")
  expect(laidOut?.starts.map(i => lines[i])).toEqual(["echo done"])
})

describe("statementSpans", () => {
  const spans = (text: string) =>
    statementSpans(text, parse(text)).map(s => ({
      text: text.slice(s.pos, s.end),
      lines: [s.first, s.last],
    }))

  test("each statement of a line's `;` and `&` is one", () => {
    expect(spans("a; b")).toEqual([
      { text: "a", lines: [1, 1] },
      { text: "b", lines: [1, 1] },
    ])
  })

  test("an `&&` chain is one statement, and a backgrounded one another", () => {
    expect(spans("a && b; c &").map(s => s.text)).toEqual(["a && b", "c &"])
  })

  test("a statement's heredoc body is its own, though another statement shares its line", () => {
    expect(spans("cat <<EOF; echo x\nbody\nEOF\necho y")).toEqual([
      { text: "cat <<EOF; echo x\nbody\nEOF", lines: [1, 3] },
      { text: "echo x", lines: [1, 1] },
      { text: "echo y", lines: [4, 4] },
    ])
  })

  test("a heredoc with no terminator spans the rest of the command, as bash reads it", () => {
    expect(spans("cat <<EOF\nbody\nmore").map(s => s.lines)).toEqual([[1, 3]])
  })

  test("a multi-line `if` spans its lines, the comment above it none", () => {
    expect(spans("# first\nif true\nthen\n  a\nfi\nb")).toEqual([
      { text: "if true\nthen\n  a\nfi", lines: [2, 5] },
      { text: "b", lines: [6, 6] },
    ])
  })

  test("a quoted multi-line `eval` is one statement over its lines", () => {
    expect(spans("eval 'a\nb'\nc").map(s => s.lines)).toEqual([
      [1, 2],
      [3, 3],
    ])
  })

  test("on the observer's command, they are the statements bash numbers, on their lines", () => {
    const text = statementsCommand()
    expect(
      statementSpans(text, parse(text)).map((s, i) => ({
        statement: i + 1,
        first: s.first,
        last: s.last,
      })),
    ).toEqual(commandStatements())
  })
})

test("a laid-out command's statements are its source's, on its layout's lines", () => {
  const { source, laidOut } = readShell(
    "mkdir -p /tmp/wc && cd /tmp/wc && git init -q && git commit -m init && ls -la; echo done",
    56,
  )
  expect(source.statements).toEqual([
    { first: 0, last: 0 },
    { first: 0, last: 0 },
  ])
  const lines = (laidOut?.spans ?? [])
    .map(s => s.text)
    .join("")
    .split("\n")
  expect(laidOut?.statements.map(s => lines[s.first])).toEqual([
    lines[0],
    "echo done",
  ])
  expect(laidOut?.statements[0]?.last).toBe(lines.length - 2)
})
