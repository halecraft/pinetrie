import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  entryId,
  type RootId,
  type RootRecord,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { newLiveDoc, newPlacesDoc, newSessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { hostDocuments, openedWords, planLoads } from "./docs.ts"

const record = (n: string, entry: string | null): RootRecord => ({
  root: rootIdFor(n),
  entry: entry === null ? null : entryId(entry),
  first: null,
  firstLine: "",
  title: null,
  messages: 0,
  newest: null,
  writers: [],
  threads: {},
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
    [rootIdFor("b"), { root: rootIdFor("b"), by: writerId("x@y.z"), at: 1 }],
  ])
  expect(planLoads(roots, archive)).toEqual([rootIdFor("a"), rootIdFor("c")])
  expect(planLoads(roots, new Map())).toEqual([
    rootIdFor("a"),
    rootIdFor("b"),
    rootIdFor("c"),
  ])
})

test("openedWords: how many roots a starting host opened, and how many it left archived", () => {
  expect(openedWords(16, 59)).toBe("opened 16 of 59 roots (43 archived)")
  expect(openedWords(5, 5)).toBe("opened 5 of 5 roots")
  expect(openedWords(1, 1)).toBe("opened 1 of 1 root")
  expect(openedWords(0, 0)).toBe("opened 0 of 0 roots")
})

test("onOpened hears every root already held, then each root as it is opened, once", async () => {
  const docs = hostDocuments({
    exchange: new Exchange({
      principal: "pinetrie-host",
      store: createInMemoryStore(),
    }),
    session: newSessionDoc(),
    live: newLiveDoc(),
    places: newPlacesDoc(),
  })
  const a = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
  const b = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
  await docs.root(a)
  const heard: RootId[] = []
  docs.onOpened(root => heard.push(root))
  expect(heard).toEqual([a])
  await docs.root(b)
  await docs.root(a)
  expect(heard).toEqual([a, b])
})
