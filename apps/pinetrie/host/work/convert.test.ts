import { laneNameForThread } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  conversionLine,
  conversionSummary,
  planConversions,
} from "./convert.ts"

test("lanes:convert tries every lane of its own, and no lane without work", () => {
  expect(
    planConversions([
      { lane: laneNameForThread("a"), work: { kind: "own" } },
      { lane: laneNameForThread("b"), work: null },
      { lane: laneNameForThread("c"), work: { kind: "own" } },
    ]),
  ).toEqual([laneNameForThread("a"), laneNameForThread("c")])
})

test("lanes:convert says which lanes will read as retired, and is silent on those on Docker", () => {
  expect(conversionLine("fix the tabs", { kind: "on-docker" })).toBeNull()
  expect(conversionLine("fix the tabs", { kind: "nothing" })).toBe(
    "fix the tabs: nothing to convert, no container volume or snapshot; it will read as retired",
  )
  expect(
    conversionLine("fix the tabs", { kind: "failed", error: "tar exited 2" }),
  ).toBe("fix the tabs: failed: tar exited 2")
})

test("lanes:convert's summary counts each outcome it came to", () => {
  expect(
    conversionSummary([
      { kind: "on-docker" },
      { kind: "converted" },
      { kind: "converted" },
      { kind: "nothing" },
    ]),
  ).toBe("4 lanes: 1 already on Docker, 2 converted, 1 with nothing to convert")
  expect(conversionSummary([])).toBe("0 lanes")
})
