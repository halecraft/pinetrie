import { commitId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { catchUpFilesOf, catchUpHolds, planCatchUpRead } from "./catch-up.ts"

const C1 = commitId("c1")
const C2 = commitId("c2")
const T = commitId("tip")
const TO = commitId("to")
test.each([
  ["the base has not moved", { start: TO, known: null }, "none"],
  ["never read", { start: C1, known: null }, "read"],
  [
    "read at this tip and commit",
    { start: C1, known: { tip: T, to: TO, files: [] } },
    "keep",
  ],
  [
    "read at another tip",
    { start: C1, known: { tip: C2, to: TO, files: [] } },
    "read",
  ],
  [
    "read at another commit",
    { start: C1, known: { tip: T, to: C2, files: [] } },
    "read",
  ],
] as const)("planCatchUpRead: %s", (_, input, expected) => {
  expect(planCatchUpRead({ ...input, to: TO, tip: T })).toBe(expected)
})
const BASE = {
  base: { kind: "accepted" },
  start: C1,
  source: C1,
} as const
const ACCEPTED = { kind: "accepted", commit: TO } as const
test.each([
  [
    "accepted work merged: where the next proposed changes start",
    { start: { kind: "known", start: [C1, C2] }, target: ACCEPTED },
    [C1, C2],
  ],
  [
    "a WIP copied: the base's start",
    {
      start: { kind: "known", start: [C2] },
      target: { kind: "wip", commit: TO },
    },
    [C1],
  ],
  [
    "an untraced start: the base's start",
    {
      start: { kind: "untraced", acceptedThreadCommits: [C2] },
      target: ACCEPTED,
    },
    [C1],
  ],
] as const)("catchUpHolds: %s", (_, input, expected) => {
  expect(catchUpHolds({ base: BASE, ...input })).toEqual(expected)
})
test.each([
  [
    "one held commit: the files the tip lacks too",
    { moved: [["a", "b", "c"]], lacking: ["c", "a"] },
    ["a", "c"],
  ],
  [
    "two: only files every held commit has differently, in the first's order",
    {
      moved: [
        ["a", "b", "c"],
        ["c", "b"],
      ],
      lacking: ["a", "b", "c"],
    },
    ["b", "c"],
  ],
  [
    "a file the base has as one held commit has it is not counted",
    { moved: [["a"], []], lacking: ["a"] },
    [],
  ],
] as const)("catchUpFilesOf: %s", (_, input, expected) => {
  expect(catchUpFilesOf(input)).toEqual(expected)
})
