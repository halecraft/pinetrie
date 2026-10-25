import {
  type OutputEvent,
  type OutputFd,
  type Settled,
  type StatementIndex,
  statementIndex,
} from "@pinetrie/core"
import type { BashOutputRecord, CallFlush } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { statementJoin } from "./statement-join.ts"

const SETTLED: CallFlush = { kind: "settled", proof: {} as Settled }
/** A record's statements, or why it is undivided. */
const statementsOf = (record: BashOutputRecord) =>
  record.verdict.kind === "split"
    ? record.verdict.statements
    : record.verdict.why
const s = (n: number): StatementIndex => {
  const i = statementIndex(n)
  if (i === null) throw new Error(`no statement ${n}`)
  return i
}
const bytes = (text: string) => new TextEncoder().encode(text)
const wrote = (n: number, fd: OutputFd, count: number): OutputEvent => ({
  kind: "output",
  fd,
  statement: s(n),
  bytes: count,
})
const signal = (n: number, line: number): OutputEvent => ({
  kind: "statement",
  at: 0,
  statement: s(n),
  line,
})

/** A join of `command` with attribution on, publishing at once, and what it sent. */
function joined(command: string) {
  const shown: { statement: number; text: string }[] = []
  let undivided = 0
  const join = statementJoin(
    command,
    { on: true },
    {
      statement: (statement, text) => shown.push({ statement, text }),
      undivided: () => {
        undivided++
      },
    },
    0,
  )
  return { join, shown, undivided: () => undivided }
}

test("a verified call shows each statement's own output, and stores it", () => {
  const { join, shown } = joined("echo a; echo bb >&2\necho c")
  join.notice(signal(1, 1))
  join.chunk("stdout", bytes("a\n"))
  join.notice(wrote(1, "stdout", 2))
  join.notice(signal(2, 1))
  join.notice(wrote(2, "stderr", 3))
  join.chunk("stderr", bytes("bb\n"))
  join.notice(signal(3, 2))
  join.chunk("stdout", bytes("c\n"))
  join.notice(wrote(3, "stdout", 2))
  expect(shown.at(-1)).toEqual({ statement: 3, text: "c\n" })
  expect(new Set(shown.map(x => x.statement))).toEqual(new Set([1, 2, 3]))
  expect(statementsOf(join.done("call", SETTLED, []))).toEqual([
    { text: "a\n", truncated: false, stderr: [] },
    { text: "bb\n", truncated: false, stderr: [{ from: 0, to: 3 }] },
    { text: "c\n", truncated: false, stderr: [] },
  ])
})

test("bytes the observer has not attributed are never shown", () => {
  const { join, shown } = joined("echo a; echo b")
  join.chunk("stdout", bytes("a\nb\n"))
  join.notice(wrote(1, "stdout", 2))
  expect(shown).toEqual([{ statement: 1, text: "a\n" }])
})

test("a statement's bytes split across chunks reach its output whole", () => {
  const { join } = joined("printf ab; printf c")
  join.chunk("stdout", bytes("a"))
  join.chunk("stdout", bytes("bc"))
  join.notice(wrote(1, "stdout", 2))
  join.notice(wrote(2, "stdout", 1))
  const stored = statementsOf(join.done("call", SETTLED, []))
  expect(typeof stored === "string" ? stored : stored.map(x => x.text)).toEqual(
    ["ab", "c"],
  )
})

test("a split that stops verifying closes its statements once, and stores why", () => {
  const { join, shown, undivided } = joined("echo a; echo b")
  join.chunk("stdout", bytes("a\n"))
  join.notice(wrote(1, "stdout", 2))
  join.chunk("stdout", bytes("b\n"))
  const before = shown.length
  expect(statementsOf(join.done("call", SETTLED, []))).toBe("count-mismatch")
  expect(undivided()).toBe(1)
  expect(shown.length).toBe(before)
})

test("a call whose lane has no observer shows nothing by statement", () => {
  const shown: unknown[] = []
  const join = statementJoin(
    "echo a",
    null,
    { statement: () => shown.push(1), undivided: () => shown.push(0) },
    0,
  )
  join.chunk("stdout", bytes("a\n"))
  join.notice(wrote(1, "stdout", 2))
  expect(statementsOf(join.done("call", SETTLED, []))).toBe("no-observer")
  expect(shown).toEqual([])
})

test("a command that does not parse is never split", () => {
  const { join } = joined("echo a &&")
  join.chunk("stdout", bytes("a"))
  join.notice(wrote(1, "stdout", 1))
  expect(statementsOf(join.done("call", SETTLED, []))).toBe("unknown-statement")
})

test("a call on sockets shows nothing by statement, and stores why", () => {
  const { join, shown } = joined("echo a; echo b")
  join.noPipes()
  join.chunk("stdout", bytes("a\n"))
  join.notice(wrote(1, "stdout", 2))
  expect(shown).toEqual([])
  expect(statementsOf(join.done("call", SETTLED, []))).toBe("no-pipes")
})

test("a record keeps the whole output's stderr it is given", () => {
  const { join } = joined("echo a")
  join.chunk("stdout", bytes("a\n"))
  join.notice(signal(1, 1))
  join.notice(wrote(1, "stdout", 2))
  expect(join.done("call", SETTLED, [{ from: 0, to: 1 }]).stderr).toEqual([
    { from: 0, to: 1 },
  ])
})
