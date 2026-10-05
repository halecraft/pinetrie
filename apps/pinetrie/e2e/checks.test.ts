import { expect, test } from "vitest"
import { createChecks, isStop, line, stopMessage, stopsHere } from "./checks.ts"

test("stopsHere: a failing check whose label is stopAt stops; nothing else does", () => {
  expect(stopsHere(false, "the colour check", "the colour check")).toBe(true)
  expect(stopsHere(true, "the colour check", "the colour check")).toBe(false)
  expect(stopsHere(false, "the colour check, again", "the colour check")).toBe(
    false,
  )
  expect(stopsHere(false, "the colour check", undefined)).toBe(false)
})

test("check prints its label and what it found; a stop matches the label, not the detail", () => {
  const printed: string[] = []
  const checks = createChecks("the x check", l => printed.push(l))
  checks.check("another", false, "the x check")
  expect(() => checks.check("the x check", false, "red")).toThrow(
    stopMessage("the x check"),
  )
  expect(checks.failed).toEqual(["another", "the x check"])
  expect(printed).toEqual([
    "  FAIL  another · the x check",
    "  FAIL  the x check · red",
    "  STOP  at the check PINETRIE_STOP_AT names",
  ])
  expect(line("a", undefined)).toBe("a")
})

test("skip is neither a pass nor a fail, and an error fails under the scenario's name", () => {
  const printed: string[] = []
  const checks = createChecks(undefined, l => printed.push(l))
  checks.skip("offers", "`container` is not running")
  checks.error("tools", "boom")
  expect([checks.passed, checks.failed, checks.skipped]).toEqual([
    [],
    ["tools"],
    ["offers"],
  ])
  expect(printed).toEqual([
    "  SKIP  offers · `container` is not running",
    "  ERROR tools · boom",
  ])
  expect(isStop(new Error(stopMessage("x")))).toBe(true)
  expect(isStop(new Error("x"))).toBe(false)
})
