import { describe, expect, test } from "vitest"
import { chooseScenarios, planSuite } from "./scenario.ts"

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
    planSuite(all, undefined, new Map([["tools", "`container` is missing"]])),
  ).toEqual({
    kind: "run",
    steps: [
      { name: "boot", run: true },
      { name: "strip", run: true },
      { name: "tools", run: false, why: "`container` is missing" },
    ],
  })
  expect(planSuite(all, "nope", new Map())).toEqual({
    kind: "unknown",
    names: ["nope"],
  })
})
