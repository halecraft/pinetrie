import { entryId, type RootId, type RootRecord, rootIdFor } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { planHeldRoots, planHold } from "./held-roots.ts"

const record = (n: string): RootRecord => ({
  root: rootIdFor(`r${n}`),
  entry: entryId(`e${n}`),
  first: entryId(`e${n}`),
  firstLine: n,
  title: null,
  messages: 1,
  newest: entryId(`e${n}`),
  writers: [],
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

describe("planHold", () => {
  const r1 = rootIdFor("r1")
  const r2 = rootIdFor("r2")
  const r3 = rootIdFor("r3")
  const set = (...roots: RootId[]): ReadonlySet<RootId> => new Set(roots)

  test("opens what is asked for and not held, and lets go of the rest", () => {
    const plan = planHold({
      asked: set(r1, r2),
      minted: set(),
      held: set(r2, r3),
    })
    expect([plan.open, plan.drop]).toEqual([[r1], [r3]])
  })

  test("a root this client started is held until the page asks for it, then only while it does", () => {
    const started = planHold({ asked: set(), minted: set(r1), held: set() })
    expect([[...started.want], started.open]).toEqual([[r1], [r1]])
    const asked = planHold({ asked: set(r1), minted: set(r1), held: set(r1) })
    expect([asked.minted.size, asked.open, asked.drop]).toEqual([0, [], []])
    const dropped = planHold({
      asked: set(),
      minted: asked.minted,
      held: set(r1),
    })
    expect(dropped.drop).toEqual([r1])
  })
})
