import { expect, test } from "vitest"
import { createChecks, stopMessage, stopsHere } from "./checks.ts"

test("stopsHere: a failing check whose label names stopAt stops; nothing else does", () => {
  expect(stopsHere(false, "the colour check (red)", "colour check")).toBe(true)
  expect(stopsHere(true, "the colour check (red)", "colour check")).toBe(false)
  expect(stopsHere(false, "the alignment check", "colour check")).toBe(false)
  expect(stopsHere(false, "the colour check", undefined)).toBe(false)
  expect(stopsHere(false, "the colour check", "")).toBe(false)
})

test("ok throws at the named failing check, after recording it; another failure goes on", () => {
  const checks = createChecks("the x check")
  checks.ok(false, "another")
  expect(() => checks.ok(false, "the x check (details)")).toThrow(
    stopMessage("the x check (details)"),
  )
  expect(checks.failed).toEqual(["another", "the x check (details)"])
})
