import { describe, expect, test } from "vitest"
import {
  chooseScenarios,
  planJobs,
  planSuite,
  type SuiteStep,
  scenarioProblem,
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

test("planSuite runs a scenario with no problem, and skips one with a reason, keeping it", () => {
  expect(
    planSuite(all, undefined, new Map([["tools", "Docker does not answer"]])),
  ).toEqual({
    kind: "run",
    steps: [
      { name: "boot", run: true },
      { name: "strip", run: true },
      { name: "tools", run: false, why: "Docker does not answer" },
    ],
  })
  expect(planSuite(all, "nope", new Map())).toEqual({
    kind: "unknown",
    names: ["nope"],
  })
})

test("scenarioProblem: one that runs lanes is skipped with the runtime's words, before its own needs; one that runs none never asks the runtime", () => {
  const docker = "Docker does not answer (`docker version`)"
  expect(scenarioProblem({ lanes: true, runtime: docker, needs: null })).toBe(
    docker,
  )
  expect(
    scenarioProblem({ lanes: true, runtime: docker, needs: "PINETRIE_LIVE" }),
  ).toBe(docker)
  expect(
    scenarioProblem({ lanes: true, runtime: null, needs: "PINETRIE_LIVE" }),
  ).toBe("PINETRIE_LIVE")
  expect(scenarioProblem({ lanes: false, runtime: docker, needs: null })).toBe(
    null,
  )
  expect(scenarioProblem({ lanes: true, runtime: null, needs: null })).toBe(
    null,
  )
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
      { name: "b", run: false, why: "no Docker" },
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
