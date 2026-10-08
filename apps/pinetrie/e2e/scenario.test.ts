import { describe, expect, test } from "vitest"
import { chooseScenarios, planSuite, scenarioProblem } from "./scenario.ts"

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
