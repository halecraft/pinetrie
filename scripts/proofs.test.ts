import { describe, expect, test } from "vitest"
import type { Mutation } from "./mutate.ts"
import { labelsIn, proofGaps, unitExpectGaps, vitestFilters } from "./proofs.ts"

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

describe("unitExpectGaps", () => {
  const unit = (expect: string, command: string[]): Mutation => ({
    name: expect,
    file: "f",
    from: "a",
    to: "b",
    command,
    expect,
  })
  const run = (...filters: string[]) => [
    "pnpm",
    "exec",
    "vitest",
    "run",
    ...filters,
  ]
  const tests = [
    {
      file: "packages/core/tree.test.ts",
      name: "threads > a race, in a branch",
    },
    { file: "packages/rules/card.test.ts", name: "a card round-trips" },
  ]

  test("an expect in a test's full name, its describe's or its file's, in the command's files, names it", () => {
    expect(
      unitExpectGaps(
        [
          unit("in a branch", run("packages/core")),
          unit("threads > a race", run("packages/core")),
          unit("tree.test.ts > threads", run()),
        ],
        tests,
      ),
    ).toEqual([])
  })

  test("an expect named only outside the command's files, or nowhere, is a gap", () => {
    expect(
      unitExpectGaps(
        [
          unit("a card round-trips", run("packages/core")),
          unit("a renamed test", run("packages/rules")),
        ],
        tests,
      ).map(g => g.mutation),
    ).toEqual(["a card round-trips", "a renamed test"])
  })

  test("a suite's mutation, a command other than vitest's, or no expect: not judged here", () => {
    expect(
      unitExpectGaps(
        [
          suite("s", "no such test"),
          unit("no such test", ["pnpm", "exec", "biome", "lint", "x.ts"]),
          { name: "x", file: "f", from: "a", to: "b", command: run() },
        ],
        tests,
      ),
    ).toEqual([])
  })

  test("vitestFilters: the paths after run, none for every file; null for any other command", () => {
    expect(vitestFilters(run("a.test.ts", "b/", "--bail"))).toEqual([
      "a.test.ts",
      "b/",
    ])
    expect(vitestFilters(run())).toEqual([])
    expect(vitestFilters(["pnpm", "exec", "biome", "lint"])).toBeNull()
  })
})
