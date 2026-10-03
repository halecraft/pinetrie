import { entryId, type RootRecord, rootIdFor, writerId } from "@pineta/core"
import { expect, test } from "vitest"
import { planLoads } from "./docs.ts"

const record = (n: string, entry: string | null): RootRecord => ({
  root: rootIdFor(n),
  entry: entry === null ? null : entryId(entry),
  first: null,
  firstLine: "",
  title: null,
  messages: 0,
  newest: null,
  writers: [],
  mentions: [],
  images: [],
})

test("planLoads: every root but the archived ones, a root with no message among them (ADR-0063)", () => {
  const roots = new Map(
    [record("a", "ea"), record("b", "eb"), record("c", null)].map(
      r => [r.root, r] as const,
    ),
  )
  const archive = new Map([
    [
      entryId("eb"),
      {
        root: entryId("eb"),
        state: "archived" as const,
        by: writerId("x@y.z"),
        at: 1,
      },
    ],
  ])
  expect(planLoads(roots, archive)).toEqual([rootIdFor("a"), rootIdFor("c")])
  expect(planLoads(roots, new Map())).toEqual([
    rootIdFor("a"),
    rootIdFor("b"),
    rootIdFor("c"),
  ])
})
