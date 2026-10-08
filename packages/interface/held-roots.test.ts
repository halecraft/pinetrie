import { entryId, type RootRecord, rootIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { planHeldRoots } from "./held-roots.ts"

const record = (n: string): RootRecord => ({
  root: rootIdFor(`r${n}`),
  entry: entryId(`e${n}`),
  first: entryId(`e${n}`),
  firstLine: n,
  title: null,
  messages: 1,
  newest: entryId(`e${n}`),
  writers: [],
  threads: {},
  mentions: [],
  images: [],
})
const directory = new Map(
  ["1", "2", "3", "4"].map(n => [rootIdFor(`r${n}`), record(n)] as const),
)
const held = (input: Parameters<typeof planHeldRoots>[0]) =>
  [...planHeldRoots(input)].sort()

describe("planHeldRoots", () => {
  test("the sidebar's roots and the one you are on, and no other", () => {
    expect(
      held({
        layout: {
          open: [entryId("e1"), entryId("e2")],
          active: { kind: "root", root: entryId("e3") },
        },
        directory,
      }),
    ).toEqual([rootIdFor("r1"), rootIdFor("r2"), rootIdFor("r3")])
  })

  test("a root the directory does not name is held by no one", () => {
    expect(
      held({
        layout: { open: [entryId("e9")], active: null },
        directory,
      }),
    ).toEqual([])
  })
})
