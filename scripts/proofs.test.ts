import { describe, expect, test } from "vitest"
import type { Mutation } from "./mutate.ts"
import { labelsIn, proofGaps } from "./proofs.ts"

const suite = (scenario: string, expect: string, name = expect): Mutation => ({
  name,
  file: "f",
  from: "a",
  to: "b",
  suite: "host",
  scenario,
  expect,
})
const gaps = (
  labels: Record<string, string[]>,
  mutations: Mutation[],
  checkCallers: string[] = [],
) =>
  proofGaps({
    labels: new Map(Object.entries(labels)),
    mutations,
    dirOf: () => "host",
    checkCallers,
  })

describe("proofGaps", () => {
  test("a label a suite mutation expects in its scenario is proven", () => {
    expect(
      gaps({ "host/chat": ["a reply"] }, [suite("chat", "a reply")]),
    ).toEqual({ unproven: [], unknown: [], duplicates: [], stray: [] })
  })
  test("a label no suite mutation expects is unproven; a unit mutation proves none", () => {
    const unit: Mutation = {
      name: "u",
      file: "f",
      from: "a",
      to: "b",
      command: ["pnpm", "test"],
      expect: "a reply",
    }
    expect(gaps({ "host/chat": ["a reply"] }, [unit]).unproven).toEqual([
      { scenario: "host/chat", label: "a reply" },
    ])
  })
  test("the same label in another scenario does not prove this one", () => {
    expect(
      gaps({ "host/chat": ["x"], "host/notes": ["x"] }, [suite("notes", "x")])
        .unproven,
    ).toEqual([{ scenario: "host/chat", label: "x" }])
  })
  test("a mutation naming no scenario, or no label in it, is unknown", () => {
    expect(
      gaps({ "host/chat": ["x"] }, [
        suite("nope", "x", "m1"),
        suite("chat", "y", "m2"),
      ]).unknown,
    ).toEqual([
      { mutation: "m1", why: "no scenario nope" },
      { mutation: "m2", why: 'no check "y" in chat' },
    ])
  })
  test("a label twice in one scenario, and a stray caller, are reported", () => {
    const g = gaps(
      { "host/chat": ["x", "x"] },
      [suite("chat", "x")],
      ["e2e/page.ts"],
    )
    expect(g.duplicates).toEqual([{ scenario: "host/chat", label: "x" }])
    expect(g.stray).toEqual(["e2e/page.ts"])
  })
})

describe("labelsIn", () => {
  test("reads labels in either quote style, across lines, and counts non-literals", () => {
    const source = `
      check("a plain one", ok)
      check(
        'say "BROWSER-OK"',
        ok,
        detail,
      )
      check(\`a template \${x}\`, ok)
      check(label, ok)
      checks.check("not a call of ours", ok)
    `
    expect(labelsIn(source)).toEqual({
      labels: ["a plain one", 'say "BROWSER-OK"'],
      nonLiteral: 2,
    })
  })
})
