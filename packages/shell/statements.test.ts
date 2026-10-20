import { parse } from "unbash"
import { describe, expect, test } from "vitest"
import { readShell } from "./read.ts"
import { statementLines } from "./statements.ts"

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
