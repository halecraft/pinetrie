import { expect, test } from "vitest"
import {
  createChecks,
  isStop,
  line,
  readSuiteCounts,
  skipCounts,
  stopMessage,
  stopsHere,
  suiteSummaryLine,
  sumSuiteCounts,
} from "./checks.ts"

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
  checks.skip("proposed", {
    requirement: "lane-runtime",
    why: "Docker does not answer",
  })
  checks.error("tools", "boom")
  expect([checks.passed, checks.failed, checks.skipped]).toEqual([
    [],
    ["tools"],
    ["proposed"],
  ])
  expect(printed).toEqual([
    "  SKIP  proposed · needs a runtime for lanes: Docker does not answer",
    "  ERROR tools · boom",
  ])
  expect(isStop(new Error(stopMessage("x")))).toBe(true)
  expect(isStop(new Error("x"))).toBe(false)
})

test("a suite's marked line counts its checks and names each skip's requirement", () => {
  expect(
    suiteSummaryLine({
      passed: 16,
      failed: 1,
      skipsBy: skipCounts([
        { requirement: "lane-vm" },
        { requirement: "lane-vm", why: "gvproxy" },
        { unmeasured: "rootless oom events" },
      ]),
    }),
  ).toBe("suite: 1 failed · 16 passed · 3 skipped (lane-vm ×2, unmeasured)")
  expect(suiteSummaryLine({ passed: 2, failed: 0, skipsBy: new Map() })).toBe(
    "suite: 2 passed",
  )
})

test("a scenario's process's counts are read back from its marked line, and none from one that crashed", () => {
  const counts = {
    passed: 3,
    failed: 1,
    skipsBy: new Map([
      ["lane-vm", 2],
      ["unmeasured", 1],
    ]),
  }
  const output = `── a\n  PASS  x\n\n${suiteSummaryLine(counts)}\n`
  expect(readSuiteCounts(output)).toEqual(counts)
  expect(readSuiteCounts("suite: 2 passed")).toEqual({
    passed: 2,
    failed: 0,
    skipsBy: new Map(),
  })
  expect(readSuiteCounts("── a\nTypeError: boom\n")).toBeNull()
})

test("two runs' counts add, their skips by requirement", () => {
  expect(
    sumSuiteCounts(
      { passed: 1, failed: 0, skipsBy: new Map([["lane-vm", 1]]) },
      {
        passed: 2,
        failed: 1,
        skipsBy: new Map([
          ["lane-vm", 1],
          ["chromium", 1],
        ]),
      },
    ),
  ).toEqual({
    passed: 3,
    failed: 1,
    skipsBy: new Map([
      ["lane-vm", 2],
      ["chromium", 1],
    ]),
  })
})
