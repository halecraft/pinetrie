import { rootIdFor, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planLoads, rootsOpenedWords } from "./docs.ts"

test("planLoads: the roots of the lanes the last host left running, once each, in order", () => {
  const [a, c] = [rootIdFor("a"), rootIdFor("c")]
  const rootOf = new Map([
    [threadIdFor("l1"), c],
    [threadIdFor("l2"), a],
    [threadIdFor("l3"), c],
  ])
  expect(
    planLoads([threadIdFor("l1"), threadIdFor("l2"), threadIdFor("l3")], lane =>
      rootOf.get(lane),
    ),
  ).toEqual([a, c])
  expect(planLoads([threadIdFor("gone")], () => undefined)).toEqual([])
  expect(planLoads([], () => a)).toEqual([])
})

test("rootsOpenedWords: how many roots a starting host opened, and why", () => {
  expect(rootsOpenedWords({ opened: 2, total: 195 })).toBe(
    "opened 2 of 195 roots: those the last host left a run open in",
  )
  expect(rootsOpenedWords({ opened: 1, total: 59 })).toBe(
    "opened 1 of 59 roots: the one the last host left a run open in",
  )
  expect(rootsOpenedWords({ opened: 0, total: 1 })).toBe(
    "opened none of 1 root",
  )
  expect(rootsOpenedWords({ opened: 0, total: 0 })).toBe(
    "opened none of 0 roots",
  )
})
