import { entryId, type RootRecord, rootIdFor } from "@pineta/core"
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
  test("your open tabs' roots and the one you are on, and no other", () => {
    expect(
      held({
        layout: {
          open: [entryId("e1"), entryId("e2")],
          active: { kind: "root", root: entryId("e3") },
        },
        preview: entryId("e4"),
        directory,
      }),
    ).toEqual([rootIdFor("r1"), rootIdFor("r2"), rootIdFor("r3")])
  })

  test("on the Archive tab, the root it previews too", () => {
    expect(
      held({
        layout: { open: [entryId("e1")], active: { kind: "archive" } },
        preview: entryId("e4"),
        directory,
      }),
    ).toEqual([rootIdFor("r1"), rootIdFor("r4")])
  })

  test("a root the directory does not name is held by no one", () => {
    expect(
      held({
        layout: { open: [entryId("e9")], active: null },
        preview: null,
        directory,
      }),
    ).toEqual([])
  })
})
