import { describe, expect, test } from "vitest"
import {
  chooseScenarios,
  planJobs,
  planSuite,
  type SuiteStep,
  scenarioProblem,
  scenarioRequirements,
  scenarioSection,
} from "./scenario.ts"

const all = ["tools", "boot", "strip"]

describe("chooseScenarios", () => {
  test("all, in name order, with nothing named", () => {
    expect(chooseScenarios(all, undefined)).toEqual(["boot", "strip", "tools"])
    expect(chooseScenarios(all, " ")).toEqual(["boot", "strip", "tools"])
  })
  test("the named ones, in name order", () => {
    expect(chooseScenarios(all, "tools, boot")).toEqual(["boot", "tools"])
  })
  test("a name that is not there is unknown", () => {
    expect(chooseScenarios(all, "boot,nope")).toEqual({ unknown: ["nope"] })
  })
})

const docker = {
  requirement: "lane-runtime",
  why: "Docker does not answer",
} as const

test("planSuite runs a scenario with no problem, and skips one with a reason, keeping it", () => {
  expect(planSuite(all, undefined, new Map([["tools", docker]]))).toEqual({
    kind: "run",
    steps: [
      { name: "boot", run: true },
      { name: "strip", run: true },
      { name: "tools", run: false, why: docker },
    ],
  })
  expect(planSuite(all, "nope", new Map())).toEqual({
    kind: "unknown",
    names: ["nope"],
  })
})

test("scenarioRequirements: one that runs lanes requires a runtime for them first, then its suite's and its own", () => {
  expect(
    scenarioRequirements({ lanes: true, requires: ["lane-vm"] }, ["chromium"]),
  ).toEqual(["lane-runtime", "chromium", "lane-vm"])
  expect(scenarioRequirements({}, [])).toEqual([])
})

test("scenarioProblem: the first requirement not met, with its probe's words", () => {
  const facts = new Map([
    ["lane-runtime", "Docker does not answer"],
    ["live-model", null],
  ] as const)
  expect(scenarioProblem(["live-model", "lane-runtime"], facts)).toEqual(docker)
  expect(scenarioProblem(["live-model"], facts)).toBeNull()
})

describe("planJobs", () => {
  const three: readonly SuiteStep[] = [
    { name: "a", run: true },
    { name: "b", run: true },
    { name: "c", run: true },
  ]
  test("several scenarios, and a suite that allows several processes: as many at once as allowed, or as there are", () => {
    expect(
      planJobs({ steps: three, jobs: { all: 2, lanes: 1 }, stopAt: undefined }),
    ).toEqual({
      kind: "processes",
      atOnce: 2,
      lanesAtOnce: 1,
    })
    expect(
      planJobs({ steps: three, jobs: { all: 8, lanes: 1 }, stopAt: undefined }),
    ).toEqual({
      kind: "processes",
      atOnce: 3,
      lanesAtOnce: 1,
    })
  })
  test("the suite's limit on scenarios with lanes is kept, and never above its limit on all", () => {
    const plan = (all: number, lanes: number) =>
      planJobs({ steps: three, jobs: { all, lanes }, stopAt: undefined })
    expect(plan(3, 2)).toMatchObject({ atOnce: 3, lanesAtOnce: 2 })
    expect(plan(2, 5)).toMatchObject({ atOnce: 2, lanesAtOnce: 2 })
  })
  test("a stop at a check runs here, in one process", () => {
    expect(
      planJobs({ steps: three, jobs: { all: 8, lanes: 1 }, stopAt: "a check" }),
    ).toEqual({
      kind: "here",
    })
  })
  test("one scenario to run, the others skipped, runs here", () => {
    const one: readonly SuiteStep[] = [
      { name: "a", run: true },
      {
        name: "b",
        run: false,
        why: { requirement: "lane-runtime", why: "no Docker" },
      },
    ]
    expect(
      planJobs({ steps: one, jobs: { all: 8, lanes: 1 }, stopAt: undefined }),
    ).toEqual({
      kind: "here",
    })
  })
  test("a suite that allows one process runs here", () => {
    expect(
      planJobs({ steps: three, jobs: { all: 1, lanes: 1 }, stopAt: undefined }),
    ).toEqual({
      kind: "here",
    })
  })
})

test("scenarioSection keeps a scenario's own lines, without the suite's title and tally", () => {
  const output = [
    "",
    "=== e2e ===",
    "",
    "── send",
    "  PASS  a check",
    "",
    "=== e2e: pass=1 fail=0 skip=0 ===",
    "",
  ].join("\n")
  expect(scenarioSection(output, "e2e")).toBe("── send\n  PASS  a check")
})
