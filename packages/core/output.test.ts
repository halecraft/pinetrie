import { describe, expect, test } from "vitest"
import {
  decodeOutputEvent,
  encodeOutputEvent,
  type OutputEvent,
  statementIndex,
} from "./index.ts"

const second = statementIndex(2)

describe("output events as lines", () => {
  test("each kind round-trips", () => {
    if (second === null) throw new Error("2 is a statement")
    const events: OutputEvent[] = [
      { kind: "statement", at: 12, statement: second, line: 3 },
      { kind: "output", fd: "stderr", statement: second, bytes: 4096 },
      { kind: "output", fd: "stdout", statement: null, bytes: 1 },
      { kind: "output-lost", count: 5 },
    ]
    for (const e of events)
      expect(decodeOutputEvent(encodeOutputEvent(e))).toEqual(e)
  })

  test("the kernel's statement 0 decodes as no statement", () => {
    expect(decodeOutputEvent("output\t1\t0\t7")).toEqual({
      kind: "output",
      fd: "stdout",
      statement: null,
      bytes: 7,
    })
  })

  test("a signal of statement 0, an unknown pipe or a stray field is no event", () => {
    expect(decodeOutputEvent("statement\t1\t0\t1")).toBeNull()
    expect(decodeOutputEvent("output\t3\t1\t7")).toBeNull()
    expect(decodeOutputEvent("output-lost\t1\t2")).toBeNull()
  })
})
